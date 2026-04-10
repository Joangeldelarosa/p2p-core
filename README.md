# p2p-core

> WebRTC-based peer-to-peer library for the web — rooms, signaling, relay fallback, chat & presence plugins.

[![Tests](https://img.shields.io/badge/tests-34%20passing-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser (Client)                      │
│                                                              │
│   P2PCore                                                    │
│   ├── SignalingClient  ─────────────── WebSocket ──┐         │
│   ├── Room (host-client topology)                  │         │
│   │   ├── PeerManager                              │         │
│   │   │   └── PeerConnection (RTCPeerConnection)   │         │
│   │   └── RelayAdapter (fallback)  ────────────────┘         │
│   └── Plugins                                                │
│       ├── ChatPlugin                                         │
│       └── PresencePlugin                                     │
└──────────────────────────────────────────────────────────────┘
                          │ WebSocket
┌──────────────────────────────────────────────────────────────┐
│            SignalingServer (Node.js / ws)                    │
│  - Assign peer IDs              - Forward offer/answer/ICE   │
│  - Manage room state            - Relay fallback             │
│  - List public rooms            - Notify peer-joined/left    │
└──────────────────────────────────────────────────────────────┘
```

**Topology: host-client** — one peer is the host, all others connect to the host. The host relays broadcasts.  
Supports up to 20 peers per room by default (configurable).

---

## Quick Start

### 1. Start the signaling server

```bash
npm run server
# → p2p-core signaling server listening on ws://0.0.0.0:8080
```

### 2. Host: create a room

```ts
import { P2PCore, ChatPlugin } from 'p2p-core';

const p2p = new P2PCore({ signalingUrl: 'ws://localhost:8080' });

const room = await p2p.createRoom({ metadata: { name: 'My Lobby' } });
console.log('Share this URL: /room/' + room.roomId);

const chat = new ChatPlugin(room);
chat.on('message', (msg) => console.log(`${msg.from}: ${msg.text}`));
chat.send('Hello everyone!');
```

### 3. Client: join a room

```ts
import { P2PCore, ChatPlugin } from 'p2p-core';

const p2p = new P2PCore({ signalingUrl: 'ws://localhost:8080' });

const room = await p2p.joinRoom('room-id-from-url');
room.on('connected', () => console.log('P2P connected!'));

const chat = new ChatPlugin(room);
chat.on('message', (msg) => console.log(`${msg.from}: ${msg.text}`));
chat.send('Hi!');
```

---

## API Reference

### `P2PCore`

Main entry point.

```ts
const p2p = new P2PCore({
  signalingUrl: 'wss://your-signaling-server.com',
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  maxPeersPerRoom: 20,
  relayFallback: true,
  debug: false,
});
```

| Method | Description |
|--------|-------------|
| `createRoom(options?)` | Create a room and become host. Returns `Promise<Room>`. |
| `joinRoom(roomId, options?)` | Join an existing room. Returns `Promise<Room>`. |
| `listRooms()` | Fetch public room list. Returns `Promise<RoomInfo[]>`. |
| `destroy()` | Close all connections. |

### `Room`

| Property/Method | Description |
|----------------|-------------|
| `room.roomId` | The room ID. |
| `room.peerId` | Your peer ID (assigned by server). |
| `room.isHost` | Whether you are the host. |
| `room.peers` | Array of `PeerInfo` for connected peers. |
| `room.send(payload, type?, to?)` | Send a message (broadcast or unicast). |
| `room.leave()` | Leave the room. |
| **Events** | `connected`, `disconnected`, `peer-joined`, `peer-left`, `message`, `error` |

### `ChatPlugin`

```ts
const chat = new ChatPlugin(room);
chat.send('Hello!');               // broadcast
chat.send('Hey', targetPeerId);    // unicast
chat.on('message', (msg) => {});   // { id, from, text, timestamp }
chat.history;                      // ChatMessage[]
```

### `PresencePlugin`

```ts
const presence = new PresencePlugin(room);
presence.announce({ status: 'online', meta: { username: 'Alice' } });
presence.on('update', (peer) => {});    // peer went online / updated
presence.on('offline', ({ peerId }) => {});
presence.online;                        // PresencePeer[]
```

---

## Modules

| Module | Description |
|--------|-------------|
| `signaling/` | WebSocket signaling client |
| `peer/` | RTCPeerConnection wrapper + multi-peer manager |
| `room/` | Host-client room with auto relay fallback |
| `relay/` | Server relay (fallback when direct P2P fails) |
| `plugins/` | Chat, Presence (more coming soon) |
| `utils/` | EventEmitter, UUID generator |
| `server/` | Minimal Node.js WebSocket signaling server |

---

## Signaling Protocol

All messages are JSON over WebSocket.

| Client → Server | Purpose |
|----------------|---------|
| `create-room` | Create a new room |
| `join-room` | Join an existing room |
| `list-rooms` | Fetch public room list |
| `offer` / `answer` / `ice-candidate` | WebRTC handshake forwarding |
| `relay` | Send message via server relay |

| Server → Client | Purpose |
|----------------|---------|
| `room-created` | Room successfully created |
| `room-joined` | Room successfully joined (with peer list) |
| `peer-joined` | Another peer joined the room |
| `peer-left` | A peer left the room |
| `rooms-list` | Public room listing |
| `error` / `room-full` / `room-not-found` / `wrong-password` | Errors |

---

## Demo

Open `examples/chat-demo/index.html` in a browser while the signaling server is running.

---

## Development

```bash
npm install          # install dependencies
npm run build        # build library (CJS + ESM + types)
npm test             # run 34 unit & integration tests
npm run server       # start the signaling server (port 8080)
```

---

## Security Notes

- Use **WSS** (TLS) in production for the signaling server.
- Room passcodes protect against uninvited joins (stored only in memory).
- WebRTC DataChannels are **DTLS-encrypted** by default.
- For competitive games, consider adding host-authoritative validation and event signing.
- Deploy your own **TURN server** (e.g. coturn) — avoid public TURN servers.

---

## Limitations

- No persistence: room state is lost on server restart.
- Host-in-browser: if the host closes their tab, the room is destroyed.
- Direct P2P is not guaranteed in all network environments (TURN is the fallback).
- Designed for ≤20 peers per room; scale with SFU/relay for more.

