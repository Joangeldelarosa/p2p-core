import { EventEmitter } from '../utils/events';
import type { Room } from '../room/Room';
import type { PeerId, P2PMessage } from '../types';

/** A single chat message. */
export interface ChatMessage {
  id: string;
  from: PeerId;
  text: string;
  timestamp: number;
}

/** Events emitted by ChatPlugin. */
export interface ChatPluginEvents {
  message: ChatMessage;
}

/**
 * Chat plugin.
 *
 * Wraps a Room and exposes a high-level chat API.
 *
 * @example
 * ```ts
 * const chat = new ChatPlugin(room);
 * chat.on('message', (msg) => console.log(msg.from, msg.text));
 * chat.send('Hello world!');
 * ```
 */
export class ChatPlugin extends EventEmitter<ChatPluginEvents> {
  private readonly _room: Room;
  private readonly _history: ChatMessage[] = [];

  constructor(room: Room) {
    super();
    this._room = room;

    room.on('message', (msg: P2PMessage) => {
      if (msg.type !== 'chat') return;
      const payload = msg.payload as { text: string; id: string };
      const chatMsg: ChatMessage = {
        id: payload.id,
        from: msg.from,
        text: payload.text,
        timestamp: msg.timestamp,
      };
      this._history.push(chatMsg);
      this.emit('message', chatMsg);
    });
  }

  /** Send a chat text message. */
  send(text: string, to?: PeerId): void {
    this._room.send<{ text: string; id: string }>(
      { text, id: this._msgId() },
      'chat',
      to,
    );
  }

  /** Full chat history received this session. */
  get history(): ChatMessage[] {
    return [...this._history];
  }

  private _msgId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }
}
