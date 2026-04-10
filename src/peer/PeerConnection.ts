import { EventEmitter } from '../utils/events';
import { DATA_CHANNEL_LABEL, ICE_GATHERING_TIMEOUT_MS } from '../config';
import type { PeerId, P2PMessage, ConnectionState } from '../types';

/** Events emitted by a single PeerConnection. */
export interface PeerConnectionEvents {
  connected: { peerId: PeerId };
  disconnected: { peerId: PeerId };
  message: P2PMessage;
  'ice-candidate': { candidate: RTCIceCandidateInit };
  'state-change': { state: ConnectionState };
  error: Error;
}

/**
 * Wraps a single RTCPeerConnection + RTCDataChannel pair.
 *
 * One PeerConnection represents the link between **this** peer and one
 * remote peer.  The host creates one PeerConnection per client; clients
 * create exactly one PeerConnection (to the host).
 */
export class PeerConnection extends EventEmitter<PeerConnectionEvents> {
  readonly peerId: PeerId;
  private readonly _pc: RTCPeerConnection;
  private _dc: RTCDataChannel | null = null;
  private _state: ConnectionState = 'new';
  private readonly _iceServers: RTCIceServer[];
  private readonly _debug: boolean;
  private _iceCandidateBuffer: RTCIceCandidateInit[] = [];

  constructor(peerId: PeerId, iceServers: RTCIceServer[], debug = false) {
    super();
    this.peerId = peerId;
    this._iceServers = iceServers;
    this._debug = debug;
    this._pc = this._createPeerConnection();
  }

  get state(): ConnectionState {
    return this._state;
  }

  get rtcPeerConnection(): RTCPeerConnection {
    return this._pc;
  }

  // ─── Offer / answer ──────────────────────────────────────────────────────────

  /**
   * (Host) Create an SDP offer and open the DataChannel.
   * Returns the local SDP after ICE gathering completes (or times out).
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this._dc = this._pc.createDataChannel(DATA_CHANNEL_LABEL, {
      ordered: true,
    });
    this._setupDataChannel(this._dc);

    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);
    return this._waitForIceGathering();
  }

  /**
   * (Client) Receive the host's SDP offer, create an answer.
   * Returns the local SDP after ICE gathering completes.
   */
  async createAnswer(remoteSdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this._pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
    const answer = await this._pc.createAnswer();
    await this._pc.setLocalDescription(answer);
    // Flush buffered ICE candidates
    for (const c of this._iceCandidateBuffer) {
      await this._pc.addIceCandidate(new RTCIceCandidate(c));
    }
    this._iceCandidateBuffer = [];
    return this._waitForIceGathering();
  }

  /**
   * (Host) Apply the client's SDP answer.
   */
  async applyAnswer(remoteSdp: RTCSessionDescriptionInit): Promise<void> {
    await this._pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
    // Flush buffered ICE candidates
    for (const c of this._iceCandidateBuffer) {
      await this._pc.addIceCandidate(new RTCIceCandidate(c));
    }
    this._iceCandidateBuffer = [];
  }

  /**
   * Add a remote ICE candidate.  Buffers candidates until remote description
   * is set.
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this._pc.remoteDescription) {
      this._iceCandidateBuffer.push(candidate);
      return;
    }
    await this._pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  // ─── Messaging ───────────────────────────────────────────────────────────────

  /** Send a P2PMessage over the DataChannel. */
  send(msg: P2PMessage): boolean {
    if (!this._dc || this._dc.readyState !== 'open') {
      this._log('DataChannel not open – cannot send');
      return false;
    }
    this._dc.send(JSON.stringify(msg));
    return true;
  }

  /** Close this peer connection. */
  close(): void {
    this._dc?.close();
    this._pc.close();
    this._setState('closed');
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this._iceServers });

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.emit('ice-candidate', { candidate: ev.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      this._log('connection state', pc.connectionState);
      switch (pc.connectionState) {
        case 'connecting':
          this._setState('connecting');
          break;
        case 'connected':
          this._setState('connected');
          this.emit('connected', { peerId: this.peerId });
          break;
        case 'disconnected':
          this._setState('reconnecting');
          break;
        case 'failed':
          this._setState('failed');
          this.emit('disconnected', { peerId: this.peerId });
          break;
        case 'closed':
          this._setState('closed');
          this.emit('disconnected', { peerId: this.peerId });
          break;
      }
    };

    // Client side: host creates the DataChannel, client receives it here.
    pc.ondatachannel = (ev) => {
      this._log('received DataChannel');
      this._dc = ev.channel;
      this._setupDataChannel(this._dc);
    };

    return pc;
  }

  private _setupDataChannel(dc: RTCDataChannel): void {
    dc.onopen = () => {
      this._log('DataChannel open');
      this._setState('connected');
      this.emit('connected', { peerId: this.peerId });
    };

    dc.onclose = () => {
      this._log('DataChannel closed');
      this.emit('disconnected', { peerId: this.peerId });
    };

    dc.onerror = (ev) => {
      const err = (ev as RTCErrorEvent).error ?? new Error('DataChannel error');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    };

    dc.onmessage = (ev) => {
      try {
        const msg: P2PMessage = JSON.parse(ev.data as string);
        this.emit('message', msg);
      } catch {
        this._log('Failed to parse DataChannel message');
      }
    };
  }

  /**
   * Wait for ICE gathering to complete (state === 'complete') or time out.
   * Returns the current localDescription SDP.
   */
  private _waitForIceGathering(): Promise<RTCSessionDescriptionInit> {
    return new Promise((resolve) => {
      if (this._pc.iceGatheringState === 'complete') {
        resolve(this._pc.localDescription!);
        return;
      }

      const timer = setTimeout(() => {
        this._log('ICE gathering timed out, using partial candidates');
        resolve(this._pc.localDescription!);
      }, ICE_GATHERING_TIMEOUT_MS);

      const onGatheringChange = () => {
        if (this._pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          this._pc.removeEventListener('icegatheringstatechange', onGatheringChange);
          resolve(this._pc.localDescription!);
        }
      };
      this._pc.addEventListener('icegatheringstatechange', onGatheringChange);
    });
  }

  private _setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit('state-change', { state });
    }
  }

  private _log(...args: unknown[]): void {
    if (this._debug) {
      console.log(`[p2p-core:peer:${this.peerId.slice(0, 8)}]`, ...args);
    }
  }
}
