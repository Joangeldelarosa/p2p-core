/** Handler function type for an event. */
export type EventHandler<T = unknown> = (data: T) => void;

/**
 * Minimal, strongly-typed EventEmitter.
 *
 * @example
 * ```ts
 * const emitter = new EventEmitter<{ message: string; count: number }>();
 * const unsub = emitter.on('message', (msg) => console.log(msg));
 * emitter.emit('message', 'hello');
 * unsub(); // remove listener
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventEmitter<Events extends Record<string, any>> {
  private readonly _handlers = new Map<keyof Events, Set<EventHandler<unknown>>>();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    this._handlers.get(event)!.add(handler as EventHandler<unknown>);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event once; the handler auto-removes after first call.
   */
  once<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    const wrapper: EventHandler<Events[K]> = (data) => {
      handler(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  /** Remove a specific handler for an event. */
  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    this._handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  /** Emit an event, calling all registered handlers synchronously. */
  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    this._handlers.get(event)?.forEach((h) => h(data));
  }

  /** Remove all handlers (optionally for a specific event). */
  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event !== undefined) {
      this._handlers.delete(event);
    } else {
      this._handlers.clear();
    }
  }
}
