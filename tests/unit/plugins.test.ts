import { ChatPlugin } from '../../src/plugins/ChatPlugin';
import { PresencePlugin } from '../../src/plugins/PresencePlugin';
import { EventEmitter } from '../../src/utils/events';
import type { RoomEvents } from '../../src/types';

/**
 * Minimal Room stub that only exposes the event bus and send() spy.
 */
function makeRoomStub() {
  const emitter = new EventEmitter<RoomEvents>();
  const sentMessages: unknown[] = [];

  const room = {
    roomId: 'test-room',
    peerId: 'local-peer',
    isHost: false,
    hostId: 'host-peer',
    peers: [],
    peerCount: 1,
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
    send: jest.fn((payload: unknown, type?: string, to?: string) => {
      sentMessages.push({ payload, type, to });
      return true;
    }),
    leave: jest.fn(),
  };

  return { room, sentMessages, emitter };
}

describe('ChatPlugin', () => {
  it('receives chat messages emitted by room', () => {
    const { room, emitter } = makeRoomStub();
    const chat = new ChatPlugin(room as never);
    const received: unknown[] = [];
    chat.on('message', (m) => received.push(m));

    emitter.emit('message', {
      type: 'chat',
      from: 'other-peer',
      payload: { text: 'hello', id: 'msg-1' },
      timestamp: 1000,
    });

    expect(received).toHaveLength(1);
    expect((received[0] as { text: string }).text).toBe('hello');
    expect((received[0] as { from: string }).from).toBe('other-peer');
  });

  it('ignores non-chat messages', () => {
    const { room, emitter } = makeRoomStub();
    const chat = new ChatPlugin(room as never);
    const received: unknown[] = [];
    chat.on('message', (m) => received.push(m));

    emitter.emit('message', {
      type: 'presence',
      from: 'other',
      payload: { status: 'online', meta: {} },
      timestamp: 1000,
    });

    expect(received).toHaveLength(0);
  });

  it('send() calls room.send with correct type', () => {
    const { room } = makeRoomStub();
    const chat = new ChatPlugin(room as never);
    chat.send('hi there');

    expect(room.send).toHaveBeenCalledTimes(1);
    const [payload, type] = (room.send as jest.Mock).mock.calls[0];
    expect(type).toBe('chat');
    expect(payload.text).toBe('hi there');
  });

  it('history accumulates received messages', () => {
    const { room, emitter } = makeRoomStub();
    const chat = new ChatPlugin(room as never);

    emitter.emit('message', {
      type: 'chat',
      from: 'p1',
      payload: { text: 'a', id: '1' },
      timestamp: 1,
    });
    emitter.emit('message', {
      type: 'chat',
      from: 'p2',
      payload: { text: 'b', id: '2' },
      timestamp: 2,
    });

    expect(chat.history).toHaveLength(2);
    expect(chat.history[0].text).toBe('a');
    expect(chat.history[1].text).toBe('b');
  });
});

describe('PresencePlugin', () => {
  it('tracks presence updates', () => {
    const { room, emitter } = makeRoomStub();
    const presence = new PresencePlugin(room as never);
    const updates: unknown[] = [];
    presence.on('update', (p) => updates.push(p));

    emitter.emit('message', {
      type: 'presence',
      from: 'peer-1',
      payload: { status: 'online', meta: { username: 'Alice' } },
      timestamp: 1000,
    });

    expect(updates).toHaveLength(1);
    const p = updates[0] as { peerId: string; status: string; meta: { username: string } };
    expect(p.peerId).toBe('peer-1');
    expect(p.status).toBe('online');
    expect(p.meta.username).toBe('Alice');
    expect(presence.online).toHaveLength(1);
  });

  it('announce() calls room.send with presence type', () => {
    const { room } = makeRoomStub();
    const presence = new PresencePlugin(room as never);
    presence.announce({ status: 'away', meta: { username: 'Bob' } });

    expect(room.send).toHaveBeenCalledTimes(1);
    const [payload, type] = (room.send as jest.Mock).mock.calls[0];
    expect(type).toBe('presence');
    expect(payload.status).toBe('away');
    expect(payload.meta.username).toBe('Bob');
  });

  it('emits offline when peer-left fires', () => {
    const { room, emitter } = makeRoomStub();
    const presence = new PresencePlugin(room as never);
    const offlines: unknown[] = [];
    presence.on('offline', (e) => offlines.push(e));

    // First add presence
    emitter.emit('message', {
      type: 'presence',
      from: 'peer-1',
      payload: { status: 'online', meta: {} },
      timestamp: 1000,
    });

    emitter.emit('peer-left', { peerId: 'peer-1' });

    expect(offlines).toHaveLength(1);
    expect((offlines[0] as { peerId: string }).peerId).toBe('peer-1');
    expect(presence.online).toHaveLength(0);
  });

  it('get() returns presence for a known peer', () => {
    const { room, emitter } = makeRoomStub();
    const presence = new PresencePlugin(room as never);

    emitter.emit('message', {
      type: 'presence',
      from: 'peer-x',
      payload: { status: 'busy', meta: {} },
      timestamp: 500,
    });

    expect(presence.get('peer-x')?.status).toBe('busy');
    expect(presence.get('unknown')).toBeUndefined();
  });
});
