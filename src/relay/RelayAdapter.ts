import { EventEmitter } from '../utils/events';
import type { SignalingClient } from '../signaling/SignalingClient';
import type { PeerId, RoomId, P2PMessage } from '../types';

/** Events emitted by RelayAdapter. */
export interface RelayAdapterEvents {
  message: P2PMessage;
}

/**
 * Relay adapter – sends/receives messages through the signaling server
 * when a direct WebRTC DataChannel is unavailable.
 *
 * This is a transparent fallback: the Room uses it automatically when
 * `PeerManager.sendTo()` returns `false`.
 */
export class RelayAdapter extends EventEmitter<RelayAdapterEvents> {
  private readonly _signaling: SignalingClient;
  private readonly _roomId: RoomId;
  private readonly _debug: boolean;

  constructor(signaling: SignalingClient, roomId: RoomId, debug = false) {
    super();
    this._signaling = signaling;
    this._roomId = roomId;
    this._debug = debug;

    // Listen for relay messages coming in from the signaling server.
    this._signaling.on('relay', ({ roomId, from, payload }) => {
      if (roomId !== this._roomId) return;
      this._log('relay message from', from);
      this.emit('message', payload as P2PMessage);
    });
  }

  /**
   * Send a message to a remote peer via the signaling server relay.
   * If `to` is omitted the server should broadcast to all room peers.
   */
  send(to: PeerId | undefined, msg: P2PMessage): void {
    this._log('relaying message to', to ?? 'all');
    this._signaling.sendRelay(this._roomId, to, msg);
  }

  private _log(...args: unknown[]): void {
    if (this._debug) {
      console.log(`[p2p-core:relay:${this._roomId.slice(0, 8)}]`, ...args);
    }
  }
}
