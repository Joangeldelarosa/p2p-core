import { EventEmitter } from '../utils/events';
import { generateId } from '../utils/id';
import type { PeerId, RoomId, RoomOptions, RoomInfo, PeerInfo, SignalingMessage } from '../types';

/** Events emitted by the SignalingClient. */
export interface SignalingClientEvents {
  /** Assigned peer ID received after connection. */
  connected: { peerId: PeerId };
  /** WebSocket closed or fatal error. */
  disconnected: { code: number; reason: string };
  /** Room was successfully created. */
  'room-created': { roomId: RoomId; peerId: PeerId };
  /** Successfully joined an existing room. */
  'room-joined': { roomId: RoomId; peerId: PeerId; peers: PeerInfo[]; hostId: PeerId };
  /** Another peer joined the room (host receives this). */
  'peer-joined': { roomId: RoomId; peerId: PeerId };
  /** A peer left the room. */
  'peer-left': { roomId: RoomId; peerId: PeerId };
  /** Received a WebRTC SDP offer from a peer. */
  offer: { roomId: RoomId; from: PeerId; sdp: RTCSessionDescriptionInit };
  /** Received a WebRTC SDP answer from a peer. */
  answer: { roomId: RoomId; from: PeerId; sdp: RTCSessionDescriptionInit };
  /** Received an ICE candidate from a peer. */
  'ice-candidate': { roomId: RoomId; from: PeerId; candidate: RTCIceCandidateInit };
  /** Server-relayed message (relay fallback). */
  relay: { roomId: RoomId; from: PeerId; payload: unknown };
  /** Room listing response. */
  'rooms-list': { rooms: RoomInfo[] };
  /** Server-sent error. */
  error: { code: string; message: string };
}

/**
 * WebSocket-based signaling client.
 *
 * Handles the low-level WebSocket transport and parses/dispatches all
 * server messages.  Higher-level classes (P2PCore, Room) use this as the
 * single connection to the signaling server.
 */
export class SignalingClient extends EventEmitter<SignalingClientEvents> {
  private ws: WebSocket | null = null;
  private _peerId: PeerId = '';
  private _connected = false;
  private _pendingMessages: SignalingMessage[] = [];
  private readonly _url: string;
  private readonly _debug: boolean;

  constructor(url: string, debug = false) {
    super();
    this._url = url;
    this._debug = debug;
  }

  get peerId(): PeerId {
    return this._peerId;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  // ─── Connection lifecycle ───────────────────────────────────────────────────

  /** Open the WebSocket connection. Resolves when the server assigns a peerId. */
  connect(): Promise<PeerId> {
    return new Promise((resolve, reject) => {
      if (this._connected) {
        resolve(this._peerId);
        return;
      }

      const ws = new WebSocket(this._url);
      this.ws = ws;

      const onOpen = () => {
        this._log('WebSocket connected, waiting for peer ID…');
      };

      const onMessage = (event: MessageEvent) => {
        try {
          const msg: SignalingMessage = JSON.parse(event.data as string);
          this._log('recv', msg.type, msg);

          if (msg.type === 'room-created' || msg.type === 'room-joined') {
            if (!this._connected) {
              const payload = msg.payload as { peerId: PeerId };
              this._peerId = payload?.peerId ?? this._peerId;
              this._connected = true;
              // Flush any queued messages
              this._flushPending();
            }
          }

          // First message from server always carries our peerId
          if (!this._peerId && msg.from) {
            this._peerId = msg.from;
          }

          this._dispatch(msg, resolve);
        } catch (err) {
          this._log('Failed to parse signaling message', err);
        }
      };

      const onError = (ev: Event) => {
        reject(new Error(`WebSocket error: ${(ev as ErrorEvent).message ?? 'unknown'}`));
      };

      const onClose = (ev: CloseEvent) => {
        this._connected = false;
        this.ws = null;
        this.emit('disconnected', { code: ev.code, reason: ev.reason });
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });
  }

  /** Close the WebSocket connection. */
  disconnect(): void {
    if (this.ws) {
      this._send({ type: 'disconnect' });
      this.ws.close(1000, 'client-disconnect');
    }
    this._connected = false;
    this.ws = null;
  }

  // ─── Room actions ───────────────────────────────────────────────────────────

  /** Ask the signaling server to create a new room. */
  createRoom(options: RoomOptions): void {
    this._send({
      type: 'create-room',
      payload: {
        roomId: options.roomId ?? generateId(),
        password: options.password,
        maxPeers: options.maxPeers,
        metadata: options.metadata,
      },
    });
  }

  /** Ask the signaling server to join an existing room. */
  joinRoom(roomId: RoomId, password?: string): void {
    this._send({ type: 'join-room', roomId, payload: { password } });
  }

  /** Ask the signaling server for a list of public rooms. */
  listRooms(): void {
    this._send({ type: 'list-rooms' });
  }

  // ─── WebRTC signaling helpers ───────────────────────────────────────────────

  sendOffer(roomId: RoomId, to: PeerId, sdp: RTCSessionDescriptionInit): void {
    this._send({ type: 'offer', roomId, to, payload: { sdp } });
  }

  sendAnswer(roomId: RoomId, to: PeerId, sdp: RTCSessionDescriptionInit): void {
    this._send({ type: 'answer', roomId, to, payload: { sdp } });
  }

  sendIceCandidate(roomId: RoomId, to: PeerId, candidate: RTCIceCandidateInit): void {
    this._send({ type: 'ice-candidate', roomId, to, payload: { candidate } });
  }

  /** Send a message via server relay (fallback when P2P direct fails). */
  sendRelay(roomId: RoomId, to: PeerId | undefined, payload: unknown): void {
    this._send({ type: 'relay', roomId, to, payload });
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private _send(msg: Partial<SignalingMessage>): void {
    const full: SignalingMessage = {
      ...(msg as SignalingMessage),
      from: this._peerId || undefined,
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(full));
      this._log('sent', full.type, full);
    } else {
      // Queue while connecting
      this._pendingMessages.push(full);
      this._log('queued (not yet open)', full.type);
    }
  }

  private _flushPending(): void {
    while (this._pendingMessages.length) {
      const msg = this._pendingMessages.shift()!;
      this.ws?.send(JSON.stringify(msg));
    }
  }

  private _dispatch(msg: SignalingMessage, resolveConnect?: (id: PeerId) => void): void {
    switch (msg.type) {
      case 'room-created': {
        const p = msg.payload as { roomId: RoomId; peerId: PeerId };
        this._peerId = p.peerId;
        this._connected = true;
        resolveConnect?.(p.peerId);
        this.emit('room-created', { roomId: p.roomId, peerId: p.peerId });
        break;
      }
      case 'room-joined': {
        const p = msg.payload as {
          roomId: RoomId;
          peerId: PeerId;
          peers: PeerInfo[];
          hostId: PeerId;
        };
        this._peerId = p.peerId;
        this._connected = true;
        resolveConnect?.(p.peerId);
        this.emit('room-joined', p);
        break;
      }
      case 'peer-joined': {
        const p = msg.payload as { peerId: PeerId };
        this.emit('peer-joined', { roomId: msg.roomId!, peerId: p.peerId });
        break;
      }
      case 'peer-left': {
        const p = msg.payload as { peerId: PeerId };
        this.emit('peer-left', { roomId: msg.roomId!, peerId: p.peerId });
        break;
      }
      case 'offer': {
        const p = msg.payload as { sdp: RTCSessionDescriptionInit };
        this.emit('offer', { roomId: msg.roomId!, from: msg.from!, sdp: p.sdp });
        break;
      }
      case 'answer': {
        const p = msg.payload as { sdp: RTCSessionDescriptionInit };
        this.emit('answer', { roomId: msg.roomId!, from: msg.from!, sdp: p.sdp });
        break;
      }
      case 'ice-candidate': {
        const p = msg.payload as { candidate: RTCIceCandidateInit };
        this.emit('ice-candidate', { roomId: msg.roomId!, from: msg.from!, candidate: p.candidate });
        break;
      }
      case 'relay': {
        this.emit('relay', { roomId: msg.roomId!, from: msg.from!, payload: msg.payload });
        break;
      }
      case 'rooms-list': {
        const p = msg.payload as { rooms: RoomInfo[] };
        this.emit('rooms-list', { rooms: p.rooms ?? [] });
        break;
      }
      case 'error':
      case 'room-full':
      case 'room-not-found':
      case 'wrong-password': {
        const p = (msg.payload as { message?: string }) ?? {};
        this.emit('error', { code: msg.type, message: p.message ?? msg.type });
        break;
      }
    }
  }

  private _log(...args: unknown[]): void {
    if (this._debug) {
      console.log('[p2p-core:signaling]', ...args);
    }
  }
}
