import type { WebSocket } from '@fastify/websocket';
import type {
  AuthResponse,
  ReadyEventData,
  ServerEvent,
  ServerEventOf,
  ServerEventType,
} from '@letopeiras/shared';
import { buildApp } from '../src/app';
import type { ServerConfig } from '../src/config';
import { openDatabase } from '../src/db';
import { hashPassword } from '../src/lib/crypto';
import { createInvite } from '../src/repo/invites';
import { createUser } from '../src/repo/users';

export const testConfig: ServerConfig = {
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:',
  trustProxy: false,
  livekit: {
    url: 'ws://127.0.0.1:7880',
    apiUrl: 'http://127.0.0.1:7880',
    apiKey: 'devkey',
    apiSecret: 'test-secret-that-is-long-enough-for-hs256',
  },
  sessionTtlMs: 24 * 60 * 60 * 1000,
  logLevel: 'silent',
};

export const PASSWORD = 'correct horse battery';

/** A fresh app over an in-memory database (seeded with #geral = 1 and voice Geral = 2). */
export async function createTestApp() {
  const db = openDatabase(':memory:');
  const app = buildApp({ config: testConfig, db });
  await app.ready();

  const admin = createUser(db, {
    username: 'admin',
    displayName: 'Admin',
    passwordHash: await hashPassword(PASSWORD),
    isAdmin: true,
  });

  const login = async (username: string, password = PASSWORD) => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username, password },
    });
    return res.json<AuthResponse>();
  };

  /** Registers a new member through an admin-created invite. */
  const register = async (username: string) => {
    const { code } = createInvite(db, admin.id, 60_000);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        inviteCode: code,
        username,
        displayName: username.toUpperCase(),
        password: PASSWORD,
      },
    });
    if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
    return res.json<AuthResponse>();
  };

  const close = async () => {
    await app.close();
    db.close();
  };

  return { app, db, admin, login, register, close };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** A WebSocket client that queues incoming events so tests can await them in order. */
export class TestSocket {
  private readonly queue: ServerEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  readonly closed: Promise<number>;
  /** Set by `connect` when it authenticates. */
  ready: ReadyEventData | undefined;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.queue.push(JSON.parse(data.toString()) as ServerEvent);
      for (const wake of this.waiters.splice(0)) wake();
    });
    this.closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  }

  send(frame: unknown): void {
    this.ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  /** Resolves with (and consumes) the first queued event of `type`. */
  async next<T extends ServerEventType>(type: T, timeoutMs = 2000): Promise<ServerEventOf<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.queue.findIndex((e) => e.type === type);
      if (index !== -1) return this.queue.splice(index, 1)[0] as ServerEventOf<T>;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timed out waiting for "${type}"`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** Whether an event of `type` arrives within `ms` (consumes it if so). */
  async receives(type: ServerEventType, ms = 150): Promise<boolean> {
    try {
      await this.next(type, ms);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.ws.terminate();
  }
}

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app'];

export async function connect(app: TestApp, token?: string): Promise<TestSocket> {
  const socket = new TestSocket(await app.injectWS('/ws'));
  if (token) {
    socket.send({ type: 'auth', data: { token } });
    socket.ready = (await socket.next('ready')).data;
  }
  return socket;
}
