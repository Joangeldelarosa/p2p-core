/**
 * Minimal WebSocket mock for unit tests.
 *
 * Simulates the browser WebSocket API so that SignalingClient can be
 * tested without a real network connection.
 */
export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;

  private _listeners = new Map<string, Set<(event: unknown) => void>>();

  /** Messages sent by the client (captured for assertions). */
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    // Simulate async open
    Promise.resolve().then(() => {
      this.readyState = MockWebSocket.OPEN;
      this._trigger('open', {});
    });
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this._listeners.get(type)?.delete(handler);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this._trigger('close', { code, reason });
  }

  /** Test helper: simulate receiving a message from the server. */
  receive(data: object): void {
    this._trigger('message', { data: JSON.stringify(data) });
  }

  private _trigger(type: string, event: unknown): void {
    this._listeners.get(type)?.forEach((h) => h(event));
  }
}
