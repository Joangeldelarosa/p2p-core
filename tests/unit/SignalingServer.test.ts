import { SignalingServer } from '../../server/SignalingServer';
import WebSocket from 'ws';

/** Helper: connect a raw WebSocket to the server and return message helpers. */
async function connectPeer(port: number) {
  return new Promise<{
    ws: WebSocket;
    send: (msg: object) => void;
    nextMessage: () => Promise<object>;
    close: () => void;
  }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const queue: object[] = [];
    const waiters: Array<(msg: object) => void> = [];

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as object;
      if (waiters.length) {
        waiters.shift()!(msg);
      } else {
        queue.push(msg);
      }
    });

    ws.on('open', () => {
      resolve({
        ws,
        send: (msg: object) => ws.send(JSON.stringify(msg)),
        nextMessage: () =>
          new Promise((res) => {
            if (queue.length) res(queue.shift()!);
            else waiters.push(res);
          }),
        close: () => ws.close(),
      });
    });
  });
}

/** Find an available TCP port. */
async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const net = require('net');
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

describe('SignalingServer (integration)', () => {
  let server: SignalingServer;
  let port: number;

  beforeEach(async () => {
    port = await getFreePort();
    server = new SignalingServer({ port, debug: false });
    // Give the server a tick to start listening
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    await server.close();
  });

  it('creates a room and returns room-created payload', async () => {
    const peer = await connectPeer(port);

    peer.send({ type: 'create-room', payload: { roomId: 'room-abc' } });
    const msg = (await peer.nextMessage()) as { type: string; payload: { roomId: string; peerId: string } };

    expect(msg.type).toBe('room-created');
    expect(msg.payload.roomId).toBe('room-abc');
    expect(typeof msg.payload.peerId).toBe('string');

    peer.close();
  });

  it('joins an existing room and returns room-joined payload', async () => {
    const host = await connectPeer(port);
    host.send({ type: 'create-room', payload: { roomId: 'room-join' } });
    const created = (await host.nextMessage()) as {
      type: string;
      payload: { roomId: string; peerId: string };
    };
    expect(created.type).toBe('room-created');

    const client = await connectPeer(port);
    client.send({ type: 'join-room', roomId: 'room-join', payload: {} });
    const [joinedMsg, peerJoinedMsg] = await Promise.all([
      client.nextMessage(),
      host.nextMessage(),
    ]);

    expect((joinedMsg as { type: string }).type).toBe('room-joined');
    expect((peerJoinedMsg as { type: string }).type).toBe('peer-joined');

    host.close();
    client.close();
  });

  it('notifies host when client disconnects', async () => {
    const host = await connectPeer(port);
    host.send({ type: 'create-room', payload: { roomId: 'room-dc' } });
    await host.nextMessage(); // room-created

    const client = await connectPeer(port);
    client.send({ type: 'join-room', roomId: 'room-dc', payload: {} });
    await client.nextMessage(); // room-joined
    await host.nextMessage(); // peer-joined

    client.close();
    const leftMsg = (await host.nextMessage()) as { type: string; payload: { peerId: string } };
    expect(leftMsg.type).toBe('peer-left');
    expect(typeof leftMsg.payload.peerId).toBe('string');

    host.close();
  });

  it('returns room-not-found when joining non-existent room', async () => {
    const peer = await connectPeer(port);
    peer.send({ type: 'join-room', roomId: 'no-such-room', payload: {} });
    const msg = (await peer.nextMessage()) as { type: string };
    expect(msg.type).toBe('room-not-found');
    peer.close();
  });

  it('returns room-full when room is at capacity', async () => {
    const host = await connectPeer(port);
    host.send({ type: 'create-room', payload: { roomId: 'room-full', maxPeers: 1 } });
    await host.nextMessage();

    const extra = await connectPeer(port);
    extra.send({ type: 'join-room', roomId: 'room-full', payload: {} });
    const msg = (await extra.nextMessage()) as { type: string };
    expect(msg.type).toBe('room-full');

    host.close();
    extra.close();
  });

  it('enforces room password', async () => {
    const host = await connectPeer(port);
    host.send({
      type: 'create-room',
      payload: { roomId: 'room-pw', password: 'secret' },
    });
    await host.nextMessage();

    const badClient = await connectPeer(port);
    badClient.send({ type: 'join-room', roomId: 'room-pw', payload: { password: 'wrong' } });
    const badMsg = (await badClient.nextMessage()) as { type: string };
    expect(badMsg.type).toBe('wrong-password');

    const goodClient = await connectPeer(port);
    goodClient.send({ type: 'join-room', roomId: 'room-pw', payload: { password: 'secret' } });
    const goodMsg = (await goodClient.nextMessage()) as { type: string };
    expect(goodMsg.type).toBe('room-joined');

    host.close();
    badClient.close();
    goodClient.close();
  });

  it('lists available rooms', async () => {
    const host = await connectPeer(port);
    host.send({ type: 'create-room', payload: { roomId: 'listable-room' } });
    await host.nextMessage();

    const guest = await connectPeer(port);
    guest.send({ type: 'list-rooms' });
    const msg = (await guest.nextMessage()) as {
      type: string;
      payload: { rooms: Array<{ roomId: string }> };
    };

    expect(msg.type).toBe('rooms-list');
    expect(msg.payload.rooms.some((r) => r.roomId === 'listable-room')).toBe(true);

    host.close();
    guest.close();
  });

  it('forwards offer/answer/ice-candidate between peers', async () => {
    const peer1 = await connectPeer(port);
    peer1.send({ type: 'create-room', payload: { roomId: 'fw-room' } });
    const created = (await peer1.nextMessage()) as {
      payload: { peerId: string };
    };
    const peer1Id = created.payload.peerId;

    const peer2 = await connectPeer(port);
    peer2.send({ type: 'join-room', roomId: 'fw-room', payload: {} });
    const [joined] = await Promise.all([peer2.nextMessage(), peer1.nextMessage()]);

    const peer2Id = (joined as { payload: { peerId: string } }).payload.peerId;

    // peer1 sends offer to peer2
    peer1.send({
      type: 'offer',
      roomId: 'fw-room',
      to: peer2Id,
      payload: { sdp: { type: 'offer', sdp: 'v=0...' } },
    });

    const offer = (await peer2.nextMessage()) as {
      type: string;
      from: string;
      payload: { sdp: object };
    };
    expect(offer.type).toBe('offer');
    expect(offer.from).toBe(peer1Id);

    peer1.close();
    peer2.close();
  });
});
