import { EventEmitter } from '../utils/events';
import { PeerConnection } from './PeerConnection';
import type { PeerId, P2PMessage } from '../types';

/** Events emitted by PeerManager. */
export interface PeerManagerEvents {
  'peer-connected': { peerId: PeerId };
  'peer-disconnected': { peerId: PeerId };
  message: P2PMessage;
  'ice-candidate': { peerId: PeerId; candidate: RTCIceCandidateInit };
  error: { peerId: PeerId; error: Error };
}

/**
 * Manages a collection of PeerConnections.
 *
 * Used by the Room to keep track of all active WebRTC connections.
 */
export class PeerManager extends EventEmitter<PeerManagerEvents> {
  private readonly _peers = new Map<PeerId, PeerConnection>();
  private readonly _iceServers: RTCIceServer[];
  private readonly _debug: boolean;

  constructor(iceServers: RTCIceServer[], debug = false) {
    super();
    this._iceServers = iceServers;
    this._debug = debug;
  }

  get peerCount(): number {
    return this._peers.size;
  }

  get peerIds(): PeerId[] {
    return Array.from(this._peers.keys());
  }

  /** Create a new PeerConnection for the given remote peer ID. */
  createPeer(peerId: PeerId): PeerConnection {
    if (this._peers.has(peerId)) {
      return this._peers.get(peerId)!;
    }
    const conn = new PeerConnection(peerId, this._iceServers, this._debug);
    this._wire(conn);
    this._peers.set(peerId, conn);
    return conn;
  }

  /** Get an existing PeerConnection. */
  getPeer(peerId: PeerId): PeerConnection | undefined {
    return this._peers.get(peerId);
  }

  /** Remove and close a peer. */
  removePeer(peerId: PeerId): void {
    const conn = this._peers.get(peerId);
    if (conn) {
      conn.close();
      this._peers.delete(peerId);
    }
  }

  /** Send a message to a specific peer. */
  sendTo(peerId: PeerId, msg: P2PMessage): boolean {
    return this._peers.get(peerId)?.send(msg) ?? false;
  }

  /** Broadcast a message to all connected peers. */
  broadcast(msg: P2PMessage): void {
    this._peers.forEach((conn) => conn.send(msg));
  }

  /** Close all peer connections and clear the map. */
  closeAll(): void {
    this._peers.forEach((conn) => conn.close());
    this._peers.clear();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _wire(conn: PeerConnection): void {
    conn.on('connected', ({ peerId }) => this.emit('peer-connected', { peerId }));
    conn.on('disconnected', ({ peerId }) => {
      this._peers.delete(peerId);
      this.emit('peer-disconnected', { peerId });
    });
    conn.on('message', (msg) => this.emit('message', msg));
    conn.on('ice-candidate', ({ candidate }) =>
      this.emit('ice-candidate', { peerId: conn.peerId, candidate }),
    );
    conn.on('error', (error) => this.emit('error', { peerId: conn.peerId, error }));
  }
}
