import { SignalingClient } from '../../src/signaling/SignalingClient';
import { MockWebSocket } from '../mocks/MockWebSocket';

// Replace the global WebSocket with our mock before each test.
let mockWs: MockWebSocket;

beforeEach(() => {
  (global as Record<string, unknown>).WebSocket = class {
    static OPEN = 1;
    constructor(url: string) {
      mockWs = new MockWebSocket(url);
      return mockWs as unknown as WebSocket;
    }
  };
});

afterEach(() => {
  delete (global as Record<string, unknown>).WebSocket;
});

describe('SignalingClient', () => {
  it('emits room-created event with correct payload', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    const connectPromise = client.connect();

    // Simulate server assigning room-created right after open
    await Promise.resolve(); // let open fire

    mockWs.receive({
      type: 'room-created',
      payload: { roomId: 'room-1', peerId: 'peer-abc' },
    });

    const peerId = await connectPromise;

    expect(peerId).toBe('peer-abc');
    expect(client.peerId).toBe('peer-abc');
    expect(client.isConnected).toBe(true);
  });

  it('emits room-joined event', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    const events: unknown[] = [];
    client.on('room-joined', (e) => events.push(e));

    client.connect();
    await Promise.resolve();

    mockWs.receive({
      type: 'room-joined',
      payload: {
        roomId: 'room-2',
        peerId: 'peer-xyz',
        peers: [],
        hostId: 'host-id',
      },
    });

    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect((events[0] as { roomId: string }).roomId).toBe('room-2');
  });

  it('emits peer-joined event', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    const events: unknown[] = [];
    client.on('peer-joined', (e) => events.push(e));

    client.connect();
    await Promise.resolve();

    // First establish a session
    mockWs.receive({
      type: 'room-created',
      payload: { roomId: 'room-1', peerId: 'host-peer' },
    });
    await Promise.resolve();

    mockWs.receive({
      type: 'peer-joined',
      roomId: 'room-1',
      payload: { peerId: 'new-peer' },
    });

    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect((events[0] as { peerId: string }).peerId).toBe('new-peer');
  });

  it('emits rooms-list event', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    const lists: unknown[] = [];
    client.on('rooms-list', (e) => lists.push(e));

    client.connect();
    await Promise.resolve();

    mockWs.receive({
      type: 'rooms-list',
      payload: { rooms: [{ roomId: 'r1', peerCount: 2 }] },
    });

    await Promise.resolve();
    expect(lists).toHaveLength(1);
    expect((lists[0] as { rooms: unknown[] }).rooms).toHaveLength(1);
  });

  it('queues messages sent before socket opens and flushes on connect', async () => {
    const client = new SignalingClient('ws://localhost:8080');

    // Connect but don't await – socket still CONNECTING
    client.connect();

    // Call createRoom before open fires
    client.createRoom({ roomId: 'queued-room' });

    // No messages sent yet (socket is still CONNECTING)
    expect(mockWs.sent).toHaveLength(0);

    // Simulate server responding with room-created (which also triggers flush)
    await Promise.resolve(); // socket open
    mockWs.receive({
      type: 'room-created',
      payload: { roomId: 'queued-room', peerId: 'p1' },
    });
    await Promise.resolve();

    // After flush the create-room message should be sent
    const sent = mockWs.sent.map((s: string) => JSON.parse(s));
    const createRoomMsg = sent.find((m: { type: string }) => m.type === 'create-room');
    expect(createRoomMsg).toBeDefined();
  });

  it('emits error event on room-not-found', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    const errors: unknown[] = [];
    client.on('error', (e) => errors.push(e));

    client.connect();
    await Promise.resolve();

    mockWs.receive({
      type: 'room-not-found',
      payload: { message: 'Room not found' },
    });

    await Promise.resolve();
    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe('room-not-found');
  });

  it('emits disconnected event when WebSocket closes', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    const disconnects: unknown[] = [];
    client.on('disconnected', (e) => disconnects.push(e));

    client.connect();
    await Promise.resolve();

    mockWs.close(1001, 'going-away');
    await Promise.resolve();

    expect(disconnects).toHaveLength(1);
    expect((disconnects[0] as { code: number }).code).toBe(1001);
  });
});
