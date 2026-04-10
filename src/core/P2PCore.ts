import { SignalingClient } from '../signaling/SignalingClient';
import { PeerManager } from '../peer/PeerManager';
import { Room } from '../room/Room';
import { RelayAdapter } from '../relay/RelayAdapter';
import { DEFAULT_CONFIG, DEFAULT_ICE_SERVERS } from '../config';
import { generateId } from '../utils/id';
import type {
  P2PConfig,
  RoomOptions,
  RoomInfo,
  PeerId,
} from '../types';

/**
 * **P2PCore** – main entry point for the p2p-core library.
 *
 * ```ts
 * const p2p = new P2PCore({ signalingUrl: 'wss://my-signaling.example.com' });
 *
 * // Host: create a room
 * const room = await p2p.createRoom({ metadata: { name: 'Game Lobby' } });
 * console.log('Share this URL: /room/' + room.roomId);
 *
 * // Client: join a room
 * const room = await p2p.joinRoom('abc-room-id');
 * room.on('message', (msg) => console.log(msg));
 * room.send('Hello everyone!', 'chat');
 * ```
 */
export class P2PCore {
  private readonly _config: Required<P2PConfig>;
  private readonly _signaling: SignalingClient;
  private readonly _rooms = new Map<string, Room>();

  constructor(config: P2PConfig) {
    this._config = {
      ...DEFAULT_CONFIG,
      ...config,
      iceServers: config.iceServers ?? DEFAULT_ICE_SERVERS,
    };
    this._signaling = new SignalingClient(config.signalingUrl, this._config.debug);
  }

  /** This peer's ID (assigned by signaling server after connection). */
  get peerId(): PeerId {
    return this._signaling.peerId;
  }

  /** Whether the signaling WebSocket is connected. */
  get isConnected(): boolean {
    return this._signaling.isConnected;
  }

  // ─── Room management ────────────────────────────────────────────────────────

  /**
   * Create a new room and become the host.
   *
   * @returns A connected {@link Room} instance.
   */
  createRoom(options: RoomOptions = {}): Promise<Room> {
    return new Promise((resolve, reject) => {
      const roomId = options.roomId ?? generateId();

      const onCreated = ({ roomId: rid, peerId }: { roomId: string; peerId: PeerId }) => {
        if (rid !== roomId) return;
        cleanup();

        const room = this._buildRoom(rid, peerId, true, peerId);
        this._rooms.set(rid, room);
        this._wireRoomSignaling(room);

        // Host is immediately "connected" (no other peers yet)
        room.emit('connected', { roomId: rid, peerId });

        resolve(room);
      };

      const onError = ({ message }: { code: string; message: string }) => {
        cleanup();
        reject(new Error(message));
      };

      const cleanup = () => {
        this._signaling.off('room-created', onCreated);
        this._signaling.off('error', onError);
      };

      this._signaling.once('room-created', onCreated);
      this._signaling.once('error', onError);

      // Ensure signaling is connected before sending
      this._ensureConnected()
        .then(() => {
          this._signaling.createRoom({ ...options, roomId });
        })
        .catch(reject);
    });
  }

  /**
   * Join an existing room as a client.
   *
   * @returns A {@link Room} instance; the `connected` event fires when the
   *          first WebRTC DataChannel opens.
   */
  joinRoom(roomId: string, options: Pick<RoomOptions, 'password'> = {}): Promise<Room> {
    return new Promise((resolve, reject) => {
      const onJoined = (payload: {
        roomId: string;
        peerId: PeerId;
        peers: Array<{ peerId: PeerId; isHost: boolean }>;
        hostId: PeerId;
      }) => {
        if (payload.roomId !== roomId) return;
        cleanup();

        const room = this._buildRoom(
          payload.roomId,
          payload.peerId,
          false,
          payload.hostId,
        );
        room.addInitialPeers(payload.peers);
        this._rooms.set(payload.roomId, room);
        this._wireRoomSignaling(room);

        // Room resolves immediately; `connected` fires once WebRTC opens
        resolve(room);
      };

      const onError = ({ message }: { code: string; message: string }) => {
        cleanup();
        reject(new Error(message));
      };

      const cleanup = () => {
        this._signaling.off('room-joined', onJoined);
        this._signaling.off('error', onError);
      };

      this._signaling.once('room-joined', onJoined);
      this._signaling.once('error', onError);

      this._ensureConnected()
        .then(() => {
          this._signaling.joinRoom(roomId, options.password);
        })
        .catch(reject);
    });
  }

  /**
   * Fetch a list of public rooms from the signaling server.
   */
  listRooms(): Promise<RoomInfo[]> {
    return new Promise((resolve, reject) => {
      const onList = ({ rooms }: { rooms: RoomInfo[] }) => {
        cleanup();
        resolve(rooms);
      };
      const onError = ({ message }: { code: string; message: string }) => {
        cleanup();
        reject(new Error(message));
      };
      const cleanup = () => {
        this._signaling.off('rooms-list', onList);
        this._signaling.off('error', onError);
      };

      this._signaling.once('rooms-list', onList);
      this._signaling.once('error', onError);

      this._ensureConnected()
        .then(() => this._signaling.listRooms())
        .catch(reject);
    });
  }

  /** Get a Room by its ID (if currently joined). */
  getRoom(roomId: string): Room | undefined {
    return this._rooms.get(roomId);
  }

  /** Disconnect from signaling server and close all rooms. */
  destroy(): void {
    this._rooms.forEach((room) => room.leave());
    this._rooms.clear();
    this._signaling.disconnect();
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _buildRoom(
    roomId: string,
    peerId: PeerId,
    isHost: boolean,
    hostId: PeerId,
  ): Room {
    const peerManager = new PeerManager(this._config.iceServers, this._config.debug);
    const relay = new RelayAdapter(this._signaling, roomId, this._config.debug);

    return new Room({
      roomId,
      peerId,
      isHost,
      hostId,
      signaling: this._signaling,
      peerManager,
      relay,
      debug: this._config.debug,
    });
  }

  /**
   * Hook signaling events into the Room so that WebRTC handshakes happen
   * automatically after join/create.
   */
  private _wireRoomSignaling(room: Room): void {
    const roomId = room.roomId;

    const offPeerJoined = this._signaling.on('peer-joined', ({ roomId: rid, peerId }) => {
      if (rid !== roomId) return;
      room.onPeerJoined(peerId);
    });

    const offPeerLeft = this._signaling.on('peer-left', ({ roomId: rid, peerId }) => {
      if (rid !== roomId) return;
      room.onPeerLeft(peerId);
    });

    const offOffer = this._signaling.on('offer', ({ roomId: rid, from, sdp }) => {
      if (rid !== roomId) return;
      room.onOffer(from, sdp);
    });

    const offAnswer = this._signaling.on('answer', ({ roomId: rid, from, sdp }) => {
      if (rid !== roomId) return;
      room.onAnswer(from, sdp);
    });

    const offIce = this._signaling.on('ice-candidate', ({ roomId: rid, from, candidate }) => {
      if (rid !== roomId) return;
      room.onIceCandidate(from, candidate);
    });

    // Teardown when room is left
    room.once('disconnected', () => {
      offPeerJoined();
      offPeerLeft();
      offOffer();
      offAnswer();
      offIce();
      this._rooms.delete(roomId);
    });
  }

  private async _ensureConnected(): Promise<void> {
    if (this._signaling.isConnected) return;
    await this._signaling.connect();
  }
}
