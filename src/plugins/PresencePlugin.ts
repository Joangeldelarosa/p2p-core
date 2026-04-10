import { EventEmitter } from '../utils/events';
import type { Room } from '../room/Room';
import type { PeerId, P2PMessage } from '../types';

/** Metadata about a presence-tracked peer. */
export interface PresencePeer {
  peerId: PeerId;
  /** Custom status string set by the peer (e.g. 'online', 'away'). */
  status: string;
  /** Arbitrary user metadata (username, avatar, etc.). */
  meta: Record<string, unknown>;
  /** Timestamp of the last presence update. */
  lastSeen: number;
}

/** Events emitted by PresencePlugin. */
export interface PresencePluginEvents {
  /** A peer updated their presence. */
  update: PresencePeer;
  /** A peer went offline. */
  offline: { peerId: PeerId };
}

/**
 * Presence plugin.
 *
 * Broadcasts presence metadata (status, custom meta) to all room peers and
 * tracks their online state.
 *
 * @example
 * ```ts
 * const presence = new PresencePlugin(room);
 * presence.announce({ status: 'online', meta: { username: 'Alice' } });
 * presence.on('update', (p) => console.log(p.peerId, 'is', p.status));
 * ```
 */
export class PresencePlugin extends EventEmitter<PresencePluginEvents> {
  private readonly _room: Room;
  private readonly _peers = new Map<PeerId, PresencePeer>();

  constructor(room: Room) {
    super();
    this._room = room;

    room.on('message', (msg: P2PMessage) => {
      if (msg.type !== 'presence') return;
      const payload = msg.payload as { status: string; meta: Record<string, unknown> };
      const entry: PresencePeer = {
        peerId: msg.from,
        status: payload.status ?? 'online',
        meta: payload.meta ?? {},
        lastSeen: msg.timestamp,
      };
      this._peers.set(msg.from, entry);
      this.emit('update', entry);
    });

    room.on('peer-left', ({ peerId }) => {
      this._peers.delete(peerId);
      this.emit('offline', { peerId });
    });
  }

  /**
   * Broadcast this peer's presence to all room members.
   */
  announce(data: { status?: string; meta?: Record<string, unknown> } = {}): void {
    this._room.send(
      { status: data.status ?? 'online', meta: data.meta ?? {} },
      'presence',
    );
  }

  /** Returns presence info for all tracked peers. */
  get online(): PresencePeer[] {
    return Array.from(this._peers.values());
  }

  /** Get presence for a specific peer. */
  get(peerId: PeerId): PresencePeer | undefined {
    return this._peers.get(peerId);
  }
}
