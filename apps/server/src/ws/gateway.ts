import type { WebSocket } from '@fastify/websocket';
import {
  clientEventSchema,
  WsCloseCode,
  type Channel,
  type ClientEvent,
  type PresenceStatus,
  type ReadyEventData,
  type ServerEvent,
  type User,
} from '@letopeiras/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db';
import { AppError, tooManyRequests } from '../lib/errors';
import { RateLimiter } from '../lib/rate-limit';
import { listCategories } from '../repo/categories';
import { findChannel, listChannels } from '../repo/channels';
import { unreadMentionCounts } from '../repo/messages';
import { listReadStates } from '../repo/read-state';
import { listRoles } from '../repo/roles';
import { findUserById, listUsers } from '../repo/users';
import { canAccess, channelForViewer } from '../services/access';
import { authenticate } from '../services/auth';
import {
  editMessage,
  markChannelRead,
  removeMessage,
  requireTextChannel,
  sendMessage,
} from '../services/messages';
import type { VoiceStateStore } from '../services/voice-state';

const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
/** Sockets per IP that haven't sent `auth` yet. */
const MAX_PENDING_PER_IP = 10;

interface Connection {
  socket: WebSocket;
  /** Refreshed when the user's tags or name change. */
  user: User;
  sessionId: number;
  /** The socket is closed once its session expires. */
  sessionExpiresAt: number;
  alive: boolean;
  status: 'online' | 'idle';
}

export interface GatewayDeps {
  db: Db;
  voice: VoiceStateStore;
  log: FastifyBaseLogger;
}

/**
 * Owns every authenticated WebSocket connection: the auth handshake, presence,
 * client event handling and broadcasting server events. Anything about a channel's
 * content only goes to people who can open that channel.
 */
export class Gateway {
  private readonly byUser = new Map<number, Set<Connection>>();
  private readonly pendingByIp = new Map<string, number>();
  // Sending, editing and deleting messages share one budget per user.
  private readonly messageLimiter = new RateLimiter(10, 10_000);
  // Every other event (read markers, presence, voice state…) per user.
  private readonly eventLimiter = new RateLimiter(60, 10_000);
  // At most one typing broadcast per user and channel every 3 s.
  private readonly typingLimiter = new RateLimiter(1, 3_000);
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly deps: GatewayDeps) {
    this.heartbeat = setInterval(() => {
      this.closeExpiredSessions();
      this.checkAlive();
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  /** Takes over a freshly opened socket from `ip`. The first frame must be `auth`. */
  accept(socket: WebSocket, ip: string): void {
    const pending = this.pendingByIp.get(ip) ?? 0;
    if (pending >= MAX_PENDING_PER_IP) {
      socket.close(WsCloseCode.TooManyConnections, 'Too many connections');
      return;
    }
    this.pendingByIp.set(ip, pending + 1);
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const left = (this.pendingByIp.get(ip) ?? 1) - 1;
      if (left > 0) this.pendingByIp.set(ip, left);
      else this.pendingByIp.delete(ip);
    };

    const timeout = setTimeout(
      () => socket.close(WsCloseCode.AuthTimeout, 'Auth timeout'),
      AUTH_TIMEOUT_MS,
    );
    socket.once('close', settle);
    socket.once('message', (raw, isBinary) => {
      settle();
      const event = isBinary ? undefined : parseEvent(raw.toString());
      if (event?.type !== 'auth') {
        socket.close(WsCloseCode.InvalidMessage, 'Expected auth');
        return;
      }
      const auth = authenticate(this.deps.db, event.data.token);
      if (!auth) {
        socket.close(WsCloseCode.Unauthorized, 'Unauthorized');
        return;
      }
      this.open({
        socket,
        user: auth.user,
        sessionId: auth.session.id,
        sessionExpiresAt: auth.session.expiresAt,
        alive: true,
        status: 'online',
      });
    });
  }

  isOnline(userId: number): boolean {
    return this.byUser.has(userId);
  }

  /** Sends to everyone. Only for events that don't reveal private channel content. */
  broadcast(event: ServerEvent, except?: (conn: Connection) => boolean): void {
    const frame = JSON.stringify(event);
    for (const conn of this.connections()) if (!except?.(conn)) sendFrame(conn, frame);
  }

  /** Sends to everyone who can open the channel. */
  broadcastToChannel(
    channel: Channel,
    event: ServerEvent,
    except?: (conn: Connection) => boolean,
  ): void {
    const frame = JSON.stringify(event);
    for (const conn of this.connections()) {
      if (!except?.(conn) && canAccess(conn.user, channel)) sendFrame(conn, frame);
    }
  }

  /** channel.created / channel.updated, with activity hidden from people without access. */
  broadcastChannel(type: 'channel.created' | 'channel.updated', channel: Channel): void {
    for (const conn of this.connections()) {
      this.sendToConn(conn, { type, data: { channel: channelForViewer(conn.user, channel) } });
    }
  }

  sendToUser(userId: number, event: ServerEvent, except?: Connection): void {
    const frame = JSON.stringify(event);
    for (const conn of this.byUser.get(userId) ?? []) if (conn !== except) sendFrame(conn, frame);
  }

  broadcastVoice(channelIds: Iterable<number>): void {
    for (const channelId of new Set(channelIds)) {
      const channel = findChannel(this.deps.db, channelId);
      if (channel) {
        this.broadcastToChannel(channel, {
          type: 'voice.state',
          data: this.deps.voice.get(channelId),
        });
      }
    }
  }

  /**
   * Re-reads users from the database and sends them a fresh `ready`, for changes that
   * alter who can see what (tags, private channels). Omit `userIds` to resync everyone.
   */
  resync(userIds?: Iterable<number>): void {
    const ids = userIds ? new Set(userIds) : new Set(this.byUser.keys());
    for (const userId of ids) {
      const user = findUserById(this.deps.db, userId);
      const conns = this.byUser.get(userId);
      if (!user || !conns) continue;
      for (const conn of conns) {
        conn.user = user;
        this.sendToConn(conn, { type: 'ready', data: this.readyFor(user) });
      }
    }
  }

  /** Keeps connections' copy of a user current (name changes). */
  refreshUser(user: User): void {
    for (const conn of this.byUser.get(user.id) ?? []) conn.user = user;
  }

  /** Disconnects every socket that authenticated with `sessionId` (e.g. after logout). */
  closeSession(sessionId: number): void {
    for (const conn of this.connections()) {
      if (conn.sessionId === sessionId) conn.socket.close(WsCloseCode.SessionRevoked, 'Logout');
    }
  }

  /** Disconnects every session of a user except `keepSessionId` (password change). */
  closeOtherSessions(userId: number, keepSessionId: number): void {
    for (const conn of this.byUser.get(userId) ?? []) {
      if (conn.sessionId !== keepSessionId) {
        conn.socket.close(WsCloseCode.SessionRevoked, 'Password changed');
      }
    }
  }

  /** Closes sockets whose session has expired (the token was only checked at `auth`). */
  closeExpiredSessions(now = Date.now()): void {
    for (const conn of this.connections()) {
      if (conn.sessionExpiresAt <= now) {
        conn.socket.close(WsCloseCode.Unauthorized, 'Session expired');
      }
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const conn of this.connections()) conn.socket.terminate();
    this.byUser.clear();
  }

  // -------------------------------------------------------------------------

  private *connections(): Generator<Connection> {
    for (const conns of this.byUser.values()) yield* conns;
  }

  /** Online if any of the user's connections is active, idle if all are idle. */
  private presenceOf(userId: number): PresenceStatus {
    const conns = this.byUser.get(userId);
    if (!conns?.size) return 'offline';
    return [...conns].some((c) => c.status === 'online') ? 'online' : 'idle';
  }

  private readyFor(user: User): ReadyEventData {
    const { db, voice } = this.deps;
    const channels = listChannels(db);
    const accessible = new Set(channels.filter((c) => canAccess(user, c)).map((c) => c.id));
    return {
      user,
      users: listUsers(db),
      channels: channels.map((c) => channelForViewer(user, c)),
      categories: listCategories(db),
      roles: listRoles(db),
      presence: [...this.byUser.keys()].map((userId) => ({
        userId,
        status: this.presenceOf(userId) === 'idle' ? 'idle' : 'online',
      })),
      voiceStates: voice.all().filter((v) => accessible.has(v.channelId)),
      readStates: listReadStates(db, user.id),
      mentions: unreadMentionCounts(db, user.id).filter((m) => accessible.has(m.channelId)),
    };
  }

  private open(conn: Connection): void {
    const before = this.presenceOf(conn.user.id);
    let conns = this.byUser.get(conn.user.id);
    if (!conns) {
      conns = new Set();
      this.byUser.set(conn.user.id, conns);
    }
    conns.add(conn);

    conn.socket.on('pong', () => (conn.alive = true));
    conn.socket.on('message', (raw, isBinary) => this.onMessage(conn, raw.toString(), isBinary));
    conn.socket.on('close', () => this.onClose(conn));

    this.sendToConn(conn, { type: 'ready', data: this.readyFor(conn.user) });
    this.announcePresence(conn.user.id, before, (c) => c.user.id === conn.user.id);
  }

  private onClose(conn: Connection): void {
    const conns = this.byUser.get(conn.user.id);
    const before = this.presenceOf(conn.user.id);
    if (!conns?.delete(conn)) return;
    if (conns.size === 0) this.byUser.delete(conn.user.id);
    this.announcePresence(conn.user.id, before);
  }

  private announcePresence(
    userId: number,
    before: PresenceStatus,
    except?: (conn: Connection) => boolean,
  ): void {
    const status = this.presenceOf(userId);
    if (status !== before)
      this.broadcast({ type: 'presence.updated', data: { userId, status } }, except);
  }

  private onMessage(conn: Connection, raw: string, isBinary: boolean): void {
    const event = isBinary ? undefined : parseEvent(raw);
    if (!event) {
      this.sendError(conn, new AppError(400, 'invalid_message', 'Mensagem inválida'));
      return;
    }
    try {
      this.handle(conn, event);
    } catch (err) {
      if (err instanceof AppError) {
        this.sendError(conn, err, event.type);
      } else {
        this.deps.log.error({ err, event: event.type }, 'WebSocket handler failed');
        this.sendError(conn, new AppError(500, 'internal', 'Erro interno do servidor'), event.type);
      }
    }
  }

  private handle(conn: Connection, event: ClientEvent): void {
    const { db, voice } = this.deps;
    const { user } = conn;

    const isMessageEvent =
      event.type === 'message.send' ||
      event.type === 'message.edit' ||
      event.type === 'message.delete';
    const limiter = isMessageEvent ? this.messageLimiter : this.eventLimiter;
    if (!limiter.consume(String(user.id))) throw tooManyRequests();

    switch (event.type) {
      case 'auth':
        throw new AppError(400, 'already_authenticated', 'Já autenticado');

      case 'message.send': {
        const { channelId, content, nonce } = event.data;
        const message = sendMessage(db, user, channelId, content);
        this.broadcastToChannel(requireTextChannel(db, user, channelId), {
          type: 'message.created',
          data: nonce === undefined ? { message } : { message, nonce },
        });
        return;
      }

      case 'message.edit': {
        const message = editMessage(db, user, event.data.messageId, event.data.content);
        this.broadcastToChannel(requireTextChannel(db, user, message.channelId), {
          type: 'message.updated',
          data: { message },
        });
        return;
      }

      case 'message.delete': {
        const message = removeMessage(db, user, event.data.messageId);
        this.broadcastToChannel(requireTextChannel(db, user, message.channelId), {
          type: 'message.deleted',
          data: { channelId: message.channelId, messageId: message.id },
        });
        return;
      }

      case 'typing.start': {
        const { channelId } = event.data;
        const channel = requireTextChannel(db, user, channelId);
        if (!this.typingLimiter.consume(`${user.id}:${channelId}`)) return;
        this.broadcastToChannel(
          channel,
          { type: 'typing', data: { channelId, userId: user.id } },
          (c) => c.user.id === user.id,
        );
        return;
      }

      case 'channel.read': {
        const { channelId, messageId } = event.data;
        if (markChannelRead(db, user, channelId, messageId)) {
          this.sendToUser(
            user.id,
            { type: 'channel.read', data: { channelId, lastReadMessageId: messageId } },
            conn,
          );
        }
        return;
      }

      case 'presence.update': {
        const before = this.presenceOf(user.id);
        conn.status = event.data.status;
        this.announcePresence(user.id, before);
        return;
      }

      case 'voice.update':
        this.broadcastVoice(voice.setSelfState(user.id, event.data.muted, event.data.deafened));
        return;
    }
  }

  private sendToConn(conn: Connection, event: ServerEvent): void {
    sendFrame(conn, JSON.stringify(event));
  }

  private sendError(conn: Connection, err: AppError, ref?: string): void {
    this.sendToConn(conn, {
      type: 'error',
      data:
        ref === undefined
          ? { code: err.code, message: err.message }
          : { code: err.code, message: err.message, ref },
    });
  }

  /** Terminates sockets that didn't answer the previous ping, then pings the rest. */
  private checkAlive(): void {
    for (const conn of this.connections()) {
      if (!conn.alive) {
        conn.socket.terminate();
        continue;
      }
      conn.alive = false;
      conn.socket.ping();
    }
  }
}

function parseEvent(raw: string): ClientEvent | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = clientEventSchema.safeParse(json);
  return result.success ? result.data : undefined;
}

function sendFrame(conn: Connection, frame: string): void {
  if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(frame);
}
