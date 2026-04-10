// ─── Core Identifiers ────────────────────────────────────────────────────────

/** Unique identifier for a peer (UUID). */
export type PeerId = string;

/** Unique identifier for a room (UUID or custom string). */
export type RoomId = string;

// ─── Configuration ────────────────────────────────────────────────────────────

/** Global library configuration. */
export interface P2PConfig {
  /** WebSocket URL of the signaling server. */
  signalingUrl: string;
  /** ICE servers (STUN/TURN). Defaults to public Google STUN. */
  iceServers?: RTCIceServer[];
  /** Maximum number of peers allowed per room (default: 20). */
  maxPeersPerRoom?: number;
  /** Fall back to server relay when P2P direct connection fails (default: true). */
  relayFallback?: boolean;
  /** Enable verbose console logging for debugging (default: false). */
  debug?: boolean;
}

// ─── Room ────────────────────────────────────────────────────────────────────

/** Options for creating or joining a room. */
export interface RoomOptions {
  /** Custom room ID; auto-generated UUID if omitted. */
  roomId?: RoomId;
  /** Optional passcode to restrict access. */
  password?: string;
  /** Maximum peers including host (default: global config). */
  maxPeers?: number;
  /** Arbitrary metadata stored with the room listing. */
  metadata?: Record<string, unknown>;
}

/** Room info returned by room discovery / signaling. */
export interface RoomInfo {
  roomId: RoomId;
  hostId: PeerId;
  peerCount: number;
  maxPeers: number;
  hasPassword: boolean;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

// ─── Peer ────────────────────────────────────────────────────────────────────

/** Information about a connected peer. */
export interface PeerInfo {
  peerId: PeerId;
  isHost: boolean;
  metadata?: Record<string, unknown>;
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** Built-in message types carried over DataChannel / relay. */
export type MessageType = 'chat' | 'presence' | 'ping' | 'pong' | 'state' | 'custom';

/** A message exchanged between peers inside a room. */
export interface P2PMessage<T = unknown> {
  /** Message category (built-in or custom string). */
  type: MessageType | string;
  /** Sender peer ID. */
  from: PeerId;
  /** Target peer ID; undefined means broadcast to all. */
  to?: PeerId;
  /** Arbitrary message content. */
  payload: T;
  /** Unix timestamp (ms) when the message was created. */
  timestamp: number;
}

// ─── Signaling protocol ───────────────────────────────────────────────────────

export type SignalingMessageType =
  | 'create-room'
  | 'join-room'
  | 'room-created'
  | 'room-joined'
  | 'peer-joined'
  | 'peer-left'
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'list-rooms'
  | 'rooms-list'
  | 'relay'
  | 'disconnect'
  | 'error'
  | 'room-full'
  | 'room-not-found'
  | 'wrong-password';

/** Messages exchanged between client and signaling server. */
export interface SignalingMessage {
  type: SignalingMessageType;
  /** Sender peer ID (set by server on outgoing messages). */
  from?: PeerId;
  /** Target peer ID for unicast messages. */
  to?: PeerId;
  /** Room context. */
  roomId?: RoomId;
  /** Message-specific content. */
  payload?: unknown;
}

// ─── Room events ──────────────────────────────────────────────────────────────

/** Events emitted by a Room instance. */
export interface RoomEvents {
  /** Fired when the room is fully connected (all initial handshakes done). */
  connected: { roomId: RoomId; peerId: PeerId };
  /** Fired when this peer leaves or the room is destroyed. */
  disconnected: { roomId: RoomId; reason?: string };
  /** A new peer joined the room. */
  'peer-joined': PeerInfo;
  /** A peer left the room. */
  'peer-left': { peerId: PeerId };
  /** Incoming data message. */
  message: P2PMessage;
  /** An error occurred inside the room. */
  error: Error;
}

// ─── Connection state ─────────────────────────────────────────────────────────

export type ConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed'
  | 'closed';
