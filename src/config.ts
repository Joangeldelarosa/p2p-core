import type { P2PConfig } from './types';

/** Public STUN servers used as the default ICE configuration. */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** Sensible defaults for P2PConfig. */
export const DEFAULT_CONFIG: Required<Omit<P2PConfig, 'signalingUrl'>> = {
  iceServers: DEFAULT_ICE_SERVERS,
  maxPeersPerRoom: 20,
  relayFallback: true,
  debug: false,
};

/** DataChannel label used for the main P2P data stream. */
export const DATA_CHANNEL_LABEL = 'p2p-core';

/** How long (ms) to wait for an ICE answer before timing out. */
export const ICE_GATHERING_TIMEOUT_MS = 10_000;

/** Interval (ms) between keep-alive pings. */
export const PING_INTERVAL_MS = 15_000;

/** How many ms without a pong before declaring a peer dead. */
export const PEER_TIMEOUT_MS = 30_000;
