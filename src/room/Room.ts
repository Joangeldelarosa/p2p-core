import { EventEmitter } from '../utils/events';
import { PeerManager } from '../peer/PeerManager';
import { RelayAdapter } from '../relay/RelayAdapter';
import type { SignalingClient } from '../signaling/SignalingClient';
import type {
  PeerId,
  RoomId,
  P2PMessage,
  PeerInfo,
  RoomEvents,
  MessageType,
} from '../types';
import { PING_INTERVAL_MS, PEER_TIMEOUT_MS } from '../config';

/**
 * Represents an active room session.
 *
 * A Room is created or joined via {@link P2PCore.createRoom} /
 * {@link P2PCore.joinRoom}.  It abstracts the underlying WebRTC mesh and
 * exposes a simple message-passing API.
 *
 * Topology: **host-client**.  The host is the single authority; all clients
 * connect to the host (not to each other).  The host relays broadcasts.
 */
export class Room extends EventEmitter<RoomEvents> {
  readonly roomId: RoomId;
  readonly peerId: PeerId;
  readonly isHost: boolean;

  private readonly _peers = new Map<PeerId, PeerInfo>();
  private readonly _peerManager: PeerManager;
  private readonly _relay: RelayAdapter;
  private readonly _signaling: SignalingClient;
  private readonly _debug: boolean;

  private _hostId: PeerId = '';
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _lastPong = new Map<PeerId, number>();

  constructor(params: {
    roomId: RoomId;
    peerId: PeerId;
    isHost: boolean;
    hostId: PeerId;
    signaling: SignalingClient;
    peerManager: PeerManager;
    relay: RelayAdapter;
    debug?: boolean;
  }) {
    super();
    this.roomId = params.roomId;
    this.peerId = params.peerId;
    this.isHost = params.isHost;
    this._hostId = params.hostId;
    this._signaling = params.signaling;
    this._peerManager = params.peerManager;
    this._relay = params.relay;
    this._debug = params.debug ?? false;

    this._wirePeerManager();
    this._wireRelay();
    this._wireSignaling();
    this._startPingLoop();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Peers currently in the room (excludes self). */
  get peers(): PeerInfo[] {
    return Array.from(this._peers.values());
  }

  /** Total occupancy including self. */
  get peerCount(): number {
    return this._peers.size + 1;
  }

  /** The host's peer ID. */
  get hostId(): PeerId {
    return this._hostId;
  }

  /**
   * Send a message to a specific peer or broadcast to all (omit `to`).
   *
   * Uses the direct DataChannel when available, otherwise falls back to
   * server relay.
   *
   * @returns `true` if the message was sent directly, `false` if relayed.
   */
  send<T = unknown>(
    payload: T,
    type: MessageType | string = 'custom',
    to?: PeerId,
  ): boolean {
    const msg: P2PMessage<T> = {
      type,
      from: this.peerId,
      to,
      payload,
      timestamp: Date.now(),
    };

    if (to) {
      return this._sendTo(to, msg as P2PMessage);
    }
    this._broadcast(msg as P2PMessage);
    return true;
  }

  /**
   * Leave the room.  Closes all WebRTC connections and stops the ping loop.
   */
  leave(): void {
    this._stopPingLoop();
    this._peerManager.closeAll();
    this.emit('disconnected', { roomId: this.roomId, reason: 'local-leave' });
  }

  // ─── Signaling integration (called by P2PCore) ──────────────────────────────

  /**
   * Called when a new peer joins (host side).
   * Opens a WebRTC connection to that peer.
   */
  async onPeerJoined(peerId: PeerId): Promise<void> {
    if (!this.isHost) return;

    this._log('new peer joined, creating offer for', peerId);
    const conn = this._peerManager.createPeer(peerId);

    conn.on('ice-candidate', ({ candidate }) => {
      this._signaling.sendIceCandidate(this.roomId, peerId, candidate);
    });

    try {
      const offer = await conn.createOffer();
      this._signaling.sendOffer(this.roomId, peerId, offer);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Called when this peer (client) receives an SDP offer from the host.
   */
  async onOffer(from: PeerId, sdp: RTCSessionDescriptionInit): Promise<void> {
    this._log('received offer from', from);
    const conn = this._peerManager.createPeer(from);

    conn.on('ice-candidate', ({ candidate }) => {
      this._signaling.sendIceCandidate(this.roomId, from, candidate);
    });

    try {
      const answer = await conn.createAnswer(sdp);
      this._signaling.sendAnswer(this.roomId, from, answer);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Called when this peer (host) receives an SDP answer.
   */
  async onAnswer(from: PeerId, sdp: RTCSessionDescriptionInit): Promise<void> {
    this._log('received answer from', from);
    const conn = this._peerManager.getPeer(from);
    if (!conn) return;
    try {
      await conn.applyAnswer(sdp);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Apply a remote ICE candidate from signaling.
   */
  async onIceCandidate(from: PeerId, candidate: RTCIceCandidateInit): Promise<void> {
    const conn = this._peerManager.getPeer(from);
    if (!conn) return;
    try {
      await conn.addIceCandidate(candidate);
    } catch (err) {
      this._log('Failed to add ICE candidate', err);
    }
  }

  /**
   * A peer left the room (signaling notification).
   */
  onPeerLeft(peerId: PeerId): void {
    this._peerManager.removePeer(peerId);
    this._peers.delete(peerId);
    this._lastPong.delete(peerId);
    this.emit('peer-left', { peerId });
  }

  /**
   * Register initial peers (received in room-joined payload).
   */
  addInitialPeers(peers: PeerInfo[]): void {
    for (const p of peers) {
      this._peers.set(p.peerId, p);
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _sendTo(peerId: PeerId, msg: P2PMessage): boolean {
    if (this._peerManager.sendTo(peerId, msg)) return true;
    // Fallback to relay
    this._relay.send(peerId, msg);
    return false;
  }

  private _broadcast(msg: P2PMessage): void {
    if (this.isHost) {
      // Host broadcasts directly to all connected peers.
      this._peers.forEach((_, peerId) => {
        if (!this._peerManager.sendTo(peerId, msg)) {
          this._relay.send(peerId, msg);
        }
      });
    } else {
      // Clients send to host; host relays.
      this._sendTo(this._hostId, msg);
    }
  }

  private _handleIncomingMessage(msg: P2PMessage): void {
    // Handle pong tracking
    if (msg.type === 'pong') {
      this._lastPong.set(msg.from, Date.now());
      return;
    }
    // Handle ping -> reply pong
    if (msg.type === 'ping') {
      this.send(null, 'pong', msg.from);
      return;
    }

    // If this is the host and message is a broadcast (no `to`), relay to others
    if (this.isHost && !msg.to) {
      this._peers.forEach((_, peerId) => {
        if (peerId !== msg.from) {
          this._peerManager.sendTo(peerId, msg) || this._relay.send(peerId, msg);
        }
      });
    }

    this.emit('message', msg);
  }

  private _wirePeerManager(): void {
    this._peerManager.on('peer-connected', ({ peerId }) => {
      const info: PeerInfo = { peerId, isHost: peerId === this._hostId };
      this._peers.set(peerId, info);
      this._lastPong.set(peerId, Date.now());
      this.emit('peer-joined', info);

      // Emit room-level connected on first connection (client side)
      if (!this.isHost) {
        this.emit('connected', { roomId: this.roomId, peerId: this.peerId });
      }
    });

    this._peerManager.on('peer-disconnected', ({ peerId }) => {
      this._peers.delete(peerId);
      this.emit('peer-left', { peerId });
    });

    this._peerManager.on('message', (msg) => this._handleIncomingMessage(msg));

    this._peerManager.on('error', ({ error }) => this.emit('error', error));
  }

  private _wireRelay(): void {
    this._relay.on('message', (msg) => this._handleIncomingMessage(msg));
  }

  private _wireSignaling(): void {
    // Already handled externally via P2PCore; nothing needed here.
  }

  private _startPingLoop(): void {
    this._pingTimer = setInterval(() => {
      const now = Date.now();
      this._peers.forEach((_, peerId) => {
        // Send ping
        this.send(null, 'ping', peerId);
        // Check for stale peers
        const lastSeen = this._lastPong.get(peerId) ?? now;
        if (now - lastSeen > PEER_TIMEOUT_MS) {
          this._log('peer timed out', peerId);
          this.onPeerLeft(peerId);
        }
      });
    }, PING_INTERVAL_MS);
  }

  private _stopPingLoop(): void {
    if (this._pingTimer !== null) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  private _log(...args: unknown[]): void {
    if (this._debug) {
      console.log(`[p2p-core:room:${this.roomId.slice(0, 8)}]`, ...args);
    }
  }
}
