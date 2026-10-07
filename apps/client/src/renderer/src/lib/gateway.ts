import {
  serverEventSchema,
  WsCloseCode,
  type ClientEventInput,
  type ServerEvent,
} from '@letopeiras/shared';
import { GATEWAY_URL } from './api';

export type GatewayStatus = 'connecting' | 'ready' | 'reconnecting';

export interface GatewayHandlers {
  onEvent(event: ServerEvent): void;
  onStatus(status: GatewayStatus): void;
  /** The server rejected the session; the gateway stops reconnecting. */
  onUnauthorized(): void;
}

const MAX_BACKOFF_MS = 15_000;

/**
 * WebSocket connection to our server. Authenticates with the first frame and
 * reconnects with exponential backoff until `close()` is called.
 */
export class Gateway {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    private readonly token: string,
    private readonly handlers: GatewayHandlers,
  ) {
    this.connect();
    window.addEventListener('online', this.retryNow);
  }

  send(event: ClientEventInput): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(event));
    return true;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    window.removeEventListener('online', this.retryNow);
    this.socket?.close(1000);
    this.socket = null;
  }

  private connect(): void {
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const socket = new WebSocket(GATEWAY_URL);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', data: { token: this.token } }));
    };
    socket.onmessage = (message) => {
      let json: unknown;
      try {
        json = JSON.parse(String(message.data));
      } catch {
        return;
      }
      const parsed = serverEventSchema.safeParse(json);
      if (!parsed.success) {
        console.warn('Ignoring unknown server event', json);
        return;
      }
      if (parsed.data.type === 'ready') {
        this.attempt = 0;
        this.handlers.onStatus('ready');
      }
      this.handlers.onEvent(parsed.data);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket || this.closed) return;
      this.socket = null;
      if (event.code === WsCloseCode.Unauthorized || event.code === WsCloseCode.SessionRevoked) {
        this.closed = true;
        this.handlers.onUnauthorized();
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    this.handlers.onStatus('reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt) * (0.75 + Math.random() / 2);
    this.attempt++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private readonly retryNow = () => {
    if (this.closed || this.socket) return;
    clearTimeout(this.retryTimer);
    this.connect();
  };
}
