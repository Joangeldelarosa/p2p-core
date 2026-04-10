// ─── Main API ────────────────────────────────────────────────────────────────
export { P2PCore } from './core/P2PCore';

// ─── Room ────────────────────────────────────────────────────────────────────
export { Room } from './room/Room';

// ─── Signaling ───────────────────────────────────────────────────────────────
export { SignalingClient } from './signaling/SignalingClient';
export type { SignalingClientEvents } from './signaling/SignalingClient';

// ─── Peer ────────────────────────────────────────────────────────────────────
export { PeerConnection } from './peer/PeerConnection';
export { PeerManager } from './peer/PeerManager';

// ─── Relay ───────────────────────────────────────────────────────────────────
export { RelayAdapter } from './relay/RelayAdapter';

// ─── Plugins ─────────────────────────────────────────────────────────────────
export { ChatPlugin } from './plugins/ChatPlugin';
export type { ChatMessage, ChatPluginEvents } from './plugins/ChatPlugin';
export { PresencePlugin } from './plugins/PresencePlugin';
export type { PresencePeer, PresencePluginEvents } from './plugins/PresencePlugin';

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  PeerId,
  RoomId,
  P2PConfig,
  RoomOptions,
  RoomInfo,
  PeerInfo,
  P2PMessage,
  MessageType,
  SignalingMessage,
  SignalingMessageType,
  RoomEvents,
  ConnectionState,
} from './types';

// ─── Utilities ───────────────────────────────────────────────────────────────
export { EventEmitter } from './utils/events';
export { generateId, generateRoomCode } from './utils/id';

// ─── Config constants ────────────────────────────────────────────────────────
export {
  DEFAULT_ICE_SERVERS,
  DEFAULT_CONFIG,
  DATA_CHANNEL_LABEL,
} from './config';
