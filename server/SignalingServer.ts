import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { generateId } from '../src/utils/id';
import type { PeerId, RoomId, SignalingMessage, RoomInfo, PeerInfo } from '../src/types';

// ─── Internal server-side data structures ────────────────────────────────────

interface ServerPeer {
  peerId: PeerId;
  ws: WebSocket;
  roomId?: RoomId;
}

interface ServerRoom {
  roomId: RoomId;
  hostId: PeerId;
  password?: string;
  maxPeers: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  peers: Set<PeerId>;
}

// ─── Server options ──────────────────────────────────────────────────────────

export interface SignalingServerOptions {
  port?: number;
  host?: string;
  /** Max peers per room (server-wide default). */
  maxPeersPerRoom?: number;
  /** Allow clients to list public rooms (default: true). */
  allowRoomListing?: boolean;
  debug?: boolean;
}

/**
 * Minimal WebSocket signaling server.
 *
 * Responsibilities:
 * - Assign peer IDs
 * - Maintain room state (in memory)
 * - Forward WebRTC offers / answers / ICE candidates between peers
 * - Relay messages as fallback
 * - Broadcast room events (peer-joined / peer-left)
 *
 * This server intentionally has **no persistence** – it is meant to be a
 * lightweight companion to the p2p-core browser library.  Room state is
 * lost on restart.
 */
export class SignalingServer {
  private readonly _wss: WebSocketServer;
  private readonly _peers = new Map<PeerId, ServerPeer>();
  private readonly _rooms = new Map<RoomId, ServerRoom>();
  private readonly _opts: Required<SignalingServerOptions>;

  constructor(opts: SignalingServerOptions = {}) {
    this._opts = {
      port: opts.port ?? 8080,
      host: opts.host ?? '0.0.0.0',
      maxPeersPerRoom: opts.maxPeersPerRoom ?? 20,
      allowRoomListing: opts.allowRoomListing ?? true,
      debug: opts.debug ?? false,
    };

    this._wss = new WebSocketServer({
      port: this._opts.port,
      host: this._opts.host,
    });

    this._wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this._onConnection(ws, req);
    });

    this._wss.on('listening', () => {
      this._log(`Signaling server listening on ws://${this._opts.host}:${this._opts.port}`);
    });
  }

  get port(): number {
    return this._opts.port;
  }

  /** Gracefully close the server. */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // ─── Connection handling ────────────────────────────────────────────────────

  private _onConnection(ws: WebSocket, _req: IncomingMessage): void {
    const peerId = generateId();
    const peer: ServerPeer = { peerId, ws };
    this._peers.set(peerId, peer);

    this._log('peer connected:', peerId);

    ws.on('message', (data: Buffer | string) => {
      try {
        const msg: SignalingMessage = JSON.parse(data.toString());
        this._handleMessage(peer, msg);
      } catch (err) {
        this._log('Failed to parse message from', peerId, err);
      }
    });

    ws.on('close', () => {
      this._log('peer disconnected:', peerId);
      this._removePeer(peerId);
    });

    ws.on('error', (err) => {
      this._log('WebSocket error for peer', peerId, err.message);
    });
  }

  // ─── Message routing ────────────────────────────────────────────────────────

  private _handleMessage(sender: ServerPeer, msg: SignalingMessage): void {
    this._log('recv', sender.peerId.slice(0, 8), msg.type);

    switch (msg.type) {
      case 'create-room':
        this._handleCreateRoom(sender, msg);
        break;
      case 'join-room':
        this._handleJoinRoom(sender, msg);
        break;
      case 'list-rooms':
        this._handleListRooms(sender);
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        this._forward(sender, msg);
        break;
      case 'relay':
        this._handleRelay(sender, msg);
        break;
      case 'disconnect':
        this._removePeer(sender.peerId);
        break;
      default:
        this._log('unknown message type:', msg.type);
    }
  }

  // ─── Room: create ──────────────────────────────────────────────────────────

  private _handleCreateRoom(sender: ServerPeer, msg: SignalingMessage): void {
    const payload = (msg.payload ?? {}) as {
      roomId?: string;
      password?: string;
      maxPeers?: number;
      metadata?: Record<string, unknown>;
    };

    const roomId: RoomId = payload.roomId ?? generateId();

    if (this._rooms.has(roomId)) {
      this._send(sender.ws, {
        type: 'error',
        payload: { message: `Room "${roomId}" already exists` },
      });
      return;
    }

    const room: ServerRoom = {
      roomId,
      hostId: sender.peerId,
      password: payload.password,
      maxPeers: payload.maxPeers ?? this._opts.maxPeersPerRoom,
      metadata: payload.metadata,
      createdAt: Date.now(),
      peers: new Set([sender.peerId]),
    };

    this._rooms.set(roomId, room);
    sender.roomId = roomId;

    this._send(sender.ws, {
      type: 'room-created',
      roomId,
      payload: { roomId, peerId: sender.peerId },
    });

    this._log('room created:', roomId, 'by', sender.peerId.slice(0, 8));
  }

  // ─── Room: join ────────────────────────────────────────────────────────────

  private _handleJoinRoom(sender: ServerPeer, msg: SignalingMessage): void {
    const roomId = msg.roomId;
    const payload = (msg.payload ?? {}) as { password?: string };

    if (!roomId || !this._rooms.has(roomId)) {
      this._send(sender.ws, { type: 'room-not-found', payload: { message: 'Room not found' } });
      return;
    }

    const room = this._rooms.get(roomId)!;

    if (room.peers.size >= room.maxPeers) {
      this._send(sender.ws, { type: 'room-full', payload: { message: 'Room is full' } });
      return;
    }

    if (room.password && room.password !== payload.password) {
      this._send(sender.ws, {
        type: 'wrong-password',
        payload: { message: 'Wrong password' },
      });
      return;
    }

    room.peers.add(sender.peerId);
    sender.roomId = roomId;

    // Build peer list (excluding the new joiner)
    const peerList: PeerInfo[] = Array.from(room.peers)
      .filter((id) => id !== sender.peerId)
      .map((id) => ({ peerId: id, isHost: id === room.hostId }));

    // Notify the new peer
    this._send(sender.ws, {
      type: 'room-joined',
      roomId,
      payload: {
        roomId,
        peerId: sender.peerId,
        peers: peerList,
        hostId: room.hostId,
      },
    });

    // Notify existing peers (host initiates WebRTC)
    room.peers.forEach((existingPeerId) => {
      if (existingPeerId === sender.peerId) return;
      const existingPeer = this._peers.get(existingPeerId);
      if (existingPeer) {
        this._send(existingPeer.ws, {
          type: 'peer-joined',
          roomId,
          payload: { peerId: sender.peerId },
        });
      }
    });

    this._log('peer', sender.peerId.slice(0, 8), 'joined room', roomId);
  }

  // ─── Room: list ────────────────────────────────────────────────────────────

  private _handleListRooms(sender: ServerPeer): void {
    if (!this._opts.allowRoomListing) {
      this._send(sender.ws, {
        type: 'rooms-list',
        payload: { rooms: [] },
      });
      return;
    }

    const rooms: RoomInfo[] = Array.from(this._rooms.values()).map((r) => ({
      roomId: r.roomId,
      hostId: r.hostId,
      peerCount: r.peers.size,
      maxPeers: r.maxPeers,
      hasPassword: !!r.password,
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));

    this._send(sender.ws, { type: 'rooms-list', payload: { rooms } });
  }

  // ─── WebRTC forwarding ─────────────────────────────────────────────────────

  private _forward(sender: ServerPeer, msg: SignalingMessage): void {
    if (!msg.to) return;
    const target = this._peers.get(msg.to);
    if (!target) {
      this._log('forward target not found:', msg.to?.slice(0, 8));
      return;
    }
    this._send(target.ws, { ...msg, from: sender.peerId });
  }

  // ─── Relay ─────────────────────────────────────────────────────────────────

  private _handleRelay(sender: ServerPeer, msg: SignalingMessage): void {
    const roomId = msg.roomId ?? sender.roomId;
    if (!roomId) return;

    if (msg.to) {
      // Unicast relay
      const target = this._peers.get(msg.to);
      if (target) {
        this._send(target.ws, { ...msg, from: sender.peerId, roomId });
      }
    } else {
      // Broadcast relay to all room members (except sender)
      const room = this._rooms.get(roomId);
      if (!room) return;
      room.peers.forEach((peerId) => {
        if (peerId === sender.peerId) return;
        const target = this._peers.get(peerId);
        if (target) {
          this._send(target.ws, { ...msg, from: sender.peerId, roomId });
        }
      });
    }
  }

  // ─── Peer removal ──────────────────────────────────────────────────────────

  private _removePeer(peerId: PeerId): void {
    const peer = this._peers.get(peerId);
    if (!peer) return;

    const roomId = peer.roomId;
    this._peers.delete(peerId);

    if (!roomId) return;
    const room = this._rooms.get(roomId);
    if (!room) return;

    room.peers.delete(peerId);

    // Notify remaining peers
    room.peers.forEach((otherId) => {
      const other = this._peers.get(otherId);
      if (other) {
        this._send(other.ws, {
          type: 'peer-left',
          roomId,
          payload: { peerId },
        });
      }
    });

    // If host left, destroy the room
    if (peerId === room.hostId) {
      this._log('host left, destroying room:', roomId);
      this._rooms.delete(roomId);
      // Disconnect all remaining peers from the room
      room.peers.forEach((otherId) => {
        const other = this._peers.get(otherId);
        if (other) {
          other.roomId = undefined;
          this._send(other.ws, {
            type: 'error',
            payload: { message: 'Host left – room destroyed' },
          });
        }
      });
    } else if (room.peers.size === 0) {
      // Empty room
      this._rooms.delete(roomId);
      this._log('empty room removed:', roomId);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private _send(ws: WebSocket, msg: Partial<SignalingMessage>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private _log(...args: unknown[]): void {
    if (this._opts.debug) {
      console.log('[p2p-core:server]', ...args);
    }
  }
}
