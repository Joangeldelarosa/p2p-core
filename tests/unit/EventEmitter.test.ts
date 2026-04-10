import { EventEmitter } from '../../src/utils/events';

describe('EventEmitter', () => {
  it('emits events to registered handlers', () => {
    const emitter = new EventEmitter<{ greet: string }>();
    const received: string[] = [];
    emitter.on('greet', (msg) => received.push(msg));
    emitter.emit('greet', 'hello');
    emitter.emit('greet', 'world');
    expect(received).toEqual(['hello', 'world']);
  });

  it('returns an unsubscribe function from on()', () => {
    const emitter = new EventEmitter<{ tick: number }>();
    const received: number[] = [];
    const unsub = emitter.on('tick', (n) => received.push(n));
    emitter.emit('tick', 1);
    unsub();
    emitter.emit('tick', 2);
    expect(received).toEqual([1]);
  });

  it('once() fires exactly once then removes itself', () => {
    const emitter = new EventEmitter<{ ping: null }>();
    let count = 0;
    emitter.once('ping', () => count++);
    emitter.emit('ping', null);
    emitter.emit('ping', null);
    expect(count).toBe(1);
  });

  it('off() removes a specific handler', () => {
    const emitter = new EventEmitter<{ data: number }>();
    const a: number[] = [];
    const b: number[] = [];
    const ha = (n: number) => a.push(n);
    const hb = (n: number) => b.push(n);
    emitter.on('data', ha);
    emitter.on('data', hb);
    emitter.emit('data', 1);
    emitter.off('data', ha);
    emitter.emit('data', 2);
    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);
  });

  it('removeAllListeners() removes all handlers for an event', () => {
    const emitter = new EventEmitter<{ x: number }>();
    let count = 0;
    emitter.on('x', () => count++);
    emitter.on('x', () => count++);
    emitter.removeAllListeners('x');
    emitter.emit('x', 1);
    expect(count).toBe(0);
  });

  it('removeAllListeners() with no argument clears everything', () => {
    const emitter = new EventEmitter<{ a: number; b: string }>();
    let countA = 0;
    let countB = 0;
    emitter.on('a', () => countA++);
    emitter.on('b', () => countB++);
    emitter.removeAllListeners();
    emitter.emit('a', 1);
    emitter.emit('b', 'x');
    expect(countA).toBe(0);
    expect(countB).toBe(0);
  });

  it('multiple independent emitters do not interfere', () => {
    const a = new EventEmitter<{ v: number }>();
    const b = new EventEmitter<{ v: number }>();
    const aVals: number[] = [];
    const bVals: number[] = [];
    a.on('v', (n) => aVals.push(n));
    b.on('v', (n) => bVals.push(n));
    a.emit('v', 1);
    b.emit('v', 2);
    expect(aVals).toEqual([1]);
    expect(bVals).toEqual([2]);
  });
});
