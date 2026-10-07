import {
  MENTION_PATTERN,
  TYPING_TIMEOUT_MS,
  type Category,
  type Channel,
  type Message,
  type Role,
  type ServerEvent,
  type User,
  type VoiceParticipant,
} from '@letopeiras/shared';
import { errorMessage, type Api } from '../lib/api';
import { Gateway, type GatewayStatus } from '../lib/gateway';
import { notifyMessage } from '../lib/notify';
import { Store } from '../lib/store';
import { showToast } from '../lib/toast';

export interface ChannelMessages {
  /** Oldest → newest. */
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
}

/** A message sent but not yet echoed back by the server. */
export interface PendingMessage {
  nonce: string;
  channelId: number;
  content: string;
  createdAt: number;
  failed: boolean;
}

export interface ChatState {
  status: GatewayStatus;
  me: User | null;
  users: Record<number, User>;
  channels: Channel[];
  categories: Category[];
  /** Sorted by position. */
  roles: Role[];
  /** Connected users and whether they're away ("Ausente"); missing = offline. */
  presence: ReadonlyMap<number, 'online' | 'idle'>;
  voice: Record<number, VoiceParticipant[]>;
  readStates: Record<number, number>;
  /** Unread messages that mention us, per channel. */
  mentionCounts: Record<number, number>;
  messages: Record<number, ChannelMessages>;
  pending: PendingMessage[];
  /** channelId → userId → expiry timestamp. */
  typing: Record<number, Record<number, number>>;
}

const TYPING_SEND_INTERVAL_MS = 4000;

const sortByPosition = <T extends { id: number; position: number }>(items: T[]) =>
  [...items].sort((a, b) => a.position - b.position || a.id - b.id);
const sortChannels = sortByPosition<Channel>;

const without = <T>(record: Record<number, T>, key: number): Record<number, T> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => Number(k) !== key));

/** Chat state fed by the gateway, plus the actions the UI can take. */
export class ChatClient {
  readonly store = new Store<ChatState>({
    status: 'connecting',
    me: null,
    users: {},
    channels: [],
    categories: [],
    roles: [],
    presence: new Map(),
    voice: {},
    readStates: {},
    mentionCounts: {},
    messages: {},
    pending: [],
    typing: {},
  });

  private readonly gateway: Gateway;
  private lastTypingSent = new Map<number, number>();
  private typingTimer: ReturnType<typeof setInterval>;
  /** The text channel on screen, so mentions there don't notify while we're looking. */
  private viewingChannelId: number | null = null;

  constructor(
    token: string,
    private readonly api: Api,
    onUnauthorized: () => void,
  ) {
    this.gateway = new Gateway(token, {
      onEvent: (event) => this.handle(event),
      onStatus: (status) => this.store.set({ status }),
      onUnauthorized,
    });
    this.typingTimer = setInterval(() => this.pruneTyping(), 1000);
  }

  close(): void {
    clearInterval(this.typingTimer);
    this.gateway.close();
  }

  // -------------------------------------------------------------------------
  // Actions

  async loadMessages(channelId: number): Promise<void> {
    const current = this.store.get().messages[channelId];
    if (current?.loading || (current && !current.hasMore)) return;
    const before = current?.messages[0]?.id;
    this.setChannelMessages(channelId, {
      messages: current?.messages ?? [],
      hasMore: current?.hasMore ?? true,
      loading: true,
    });
    try {
      const page = await this.api.messages(channelId, before);
      const latest = this.store.get().messages[channelId];
      const known = new Set(latest?.messages.map((m) => m.id));
      this.setChannelMessages(channelId, {
        messages: [...page.messages.filter((m) => !known.has(m.id)), ...(latest?.messages ?? [])],
        hasMore: page.hasMore,
        loading: false,
      });
    } catch (err) {
      const latest = this.store.get().messages[channelId];
      this.setChannelMessages(channelId, {
        messages: latest?.messages ?? [],
        hasMore: latest?.hasMore ?? true,
        loading: false,
      });
      showToast(`Não foi possível carregar as mensagens: ${errorMessage(err)}`);
    }
  }

  sendMessage(channelId: number, content: string): void {
    const pending: PendingMessage = {
      nonce: crypto.randomUUID(),
      channelId,
      content,
      createdAt: Date.now(),
      failed: false,
    };
    this.store.set((s) => ({ pending: [...s.pending, pending] }));
    this.lastTypingSent.delete(channelId);
    this.trySend(pending);
  }

  retryMessage(nonce: string): void {
    const pending = this.store.get().pending.find((p) => p.nonce === nonce);
    if (!pending) return;
    this.updatePending(nonce, { failed: false });
    this.trySend(pending);
  }

  discardMessage(nonce: string): void {
    this.store.set((s) => ({ pending: s.pending.filter((p) => p.nonce !== nonce) }));
  }

  editMessage(messageId: number, content: string): void {
    this.sendOrWarn({ type: 'message.edit', data: { messageId, content } });
  }

  deleteMessage(messageId: number): void {
    this.sendOrWarn({ type: 'message.delete', data: { messageId } });
  }

  startTyping(channelId: number): void {
    const now = Date.now();
    if (now - (this.lastTypingSent.get(channelId) ?? 0) < TYPING_SEND_INTERVAL_MS) return;
    this.lastTypingSent.set(channelId, now);
    this.gateway.send({ type: 'typing.start', data: { channelId } });
  }

  /** Marks everything in the channel as read. */
  markRead(channelId: number): void {
    const { channels, readStates } = this.store.get();
    const last = channels.find((c) => c.id === channelId)?.lastMessageId;
    if (!last || (readStates[channelId] ?? 0) >= last) return;
    if (!this.gateway.send({ type: 'channel.read', data: { channelId, messageId: last } })) return;
    this.store.set((s) => ({
      readStates: { ...s.readStates, [channelId]: last },
      mentionCounts: without(s.mentionCounts, channelId),
    }));
  }

  setViewingChannel(channelId: number | null): void {
    this.viewingChannelId = channelId;
  }

  /** "Ausente" while the PC has been idle for a while. */
  reportPresence(status: 'online' | 'idle'): void {
    this.gateway.send({ type: 'presence.update', data: { status } });
  }

  reportVoiceState(muted: boolean, deafened: boolean): void {
    this.gateway.send({ type: 'voice.update', data: { muted, deafened } });
  }

  // -------------------------------------------------------------------------
  // Server events

  private handle(event: ServerEvent): void {
    switch (event.type) {
      case 'ready': {
        const {
          user,
          users,
          channels,
          categories,
          roles,
          presence,
          voiceStates,
          readStates,
          mentions,
        } = event.data;
        // Anything could have happened while we were away; history is fetched again.
        this.store.set({
          me: user,
          users: Object.fromEntries(users.map((u) => [u.id, u])),
          channels: sortChannels(channels),
          categories: sortByPosition(categories),
          roles: sortByPosition(roles),
          presence: new Map(presence.map((p) => [p.userId, p.status])),
          voice: Object.fromEntries(voiceStates.map((v) => [v.channelId, v.participants])),
          readStates: Object.fromEntries(readStates.map((r) => [r.channelId, r.lastReadMessageId])),
          mentionCounts: Object.fromEntries(mentions.map((m) => [m.channelId, m.count])),
          messages: {},
          typing: {},
          // In-flight messages may or may not have reached the server; resending them
          // automatically could duplicate them, so the user decides.
          pending: this.store.get().pending.map((p) => ({ ...p, failed: true })),
        });
        return;
      }

      case 'message.created': {
        const { message, nonce } = event.data;
        const before = this.store.get();
        const channel = before.channels.find((c) => c.id === message.channelId);
        const mentionsMe =
          before.me !== null &&
          message.authorId !== before.me.id &&
          (message.mentionIds.includes(before.me.id) || message.mentionsEveryone);
        if (channel && message.authorId !== before.me?.id) {
          // "@joao" reads better as "@João" in the toast.
          const content = message.content.replace(MENTION_PATTERN, (match, name: string) => {
            const user = Object.values(before.users).find((u) => u.username === name.toLowerCase());
            return user ? `@${user.displayName}` : match;
          });
          notifyMessage({ ...message, content }, before.users[message.authorId], channel, {
            mentionsMe,
            direct: before.me !== null && message.mentionIds.includes(before.me.id),
            viewing: this.viewingChannelId === channel.id,
          });
        }
        if (mentionsMe && message.authorId !== before.me?.id) {
          this.store.set((s) => ({
            mentionCounts: {
              ...s.mentionCounts,
              [message.channelId]: (s.mentionCounts[message.channelId] ?? 0) + 1,
            },
          }));
        }
        this.store.set((s) => {
          const list = s.messages[message.channelId];
          const fromMe = message.authorId === s.me?.id;
          const typing = s.typing[message.channelId];
          return {
            messages:
              list && !list.messages.some((m) => m.id === message.id)
                ? {
                    ...s.messages,
                    [message.channelId]: { ...list, messages: [...list.messages, message] },
                  }
                : s.messages,
            pending: nonce ? s.pending.filter((p) => p.nonce !== nonce) : s.pending,
            channels: s.channels.map((c) =>
              c.id === message.channelId ? { ...c, lastMessageId: message.id } : c,
            ),
            readStates: fromMe
              ? { ...s.readStates, [message.channelId]: message.id }
              : s.readStates,
            typing: typing?.[message.authorId]
              ? { ...s.typing, [message.channelId]: without(typing, message.authorId) }
              : s.typing,
          };
        });
        return;
      }

      case 'message.updated': {
        const { message } = event.data;
        this.updateMessages(message.channelId, (list) =>
          list.map((m) => (m.id === message.id ? message : m)),
        );
        return;
      }

      case 'message.deleted': {
        const { channelId, messageId } = event.data;
        this.updateMessages(channelId, (list) => list.filter((m) => m.id !== messageId));
        this.store.set((s) => ({
          channels: s.channels.map((c) => {
            if (c.id !== channelId || c.lastMessageId !== messageId) return c;
            const remaining = s.messages[channelId]?.messages;
            return { ...c, lastMessageId: remaining?.at(-1)?.id ?? null };
          }),
        }));
        return;
      }

      case 'presence.updated': {
        const { userId, status } = event.data;
        this.store.set((s) => {
          const presence = new Map(s.presence);
          if (status === 'offline') presence.delete(userId);
          else presence.set(userId, status);
          return { presence };
        });
        return;
      }

      case 'typing': {
        const { channelId, userId } = event.data;
        this.store.set((s) => ({
          typing: {
            ...s.typing,
            [channelId]: { ...s.typing[channelId], [userId]: Date.now() + TYPING_TIMEOUT_MS },
          },
        }));
        return;
      }

      case 'voice.state':
        this.store.set((s) => ({
          voice: { ...s.voice, [event.data.channelId]: event.data.participants },
        }));
        return;

      case 'user.created':
      case 'user.updated': {
        const { user } = event.data;
        this.store.set((s) => ({
          users: { ...s.users, [user.id]: user },
          me: s.me?.id === user.id ? user : s.me,
        }));
        return;
      }

      case 'category.created':
      case 'category.updated': {
        const { category } = event.data;
        this.store.set((s) => ({
          categories: sortByPosition([
            ...s.categories.filter((c) => c.id !== category.id),
            category,
          ]),
        }));
        return;
      }

      case 'category.deleted':
        this.store.set((s) => ({
          categories: s.categories.filter((c) => c.id !== event.data.categoryId),
        }));
        return;

      case 'role.created':
      case 'role.updated': {
        const { role } = event.data;
        this.store.set((s) => ({
          roles: sortByPosition([...s.roles.filter((r) => r.id !== role.id), role]),
        }));
        return;
      }

      case 'channel.created':
      case 'channel.updated': {
        const { channel } = event.data;
        this.store.set((s) => ({
          channels: sortChannels([...s.channels.filter((c) => c.id !== channel.id), channel]),
        }));
        return;
      }

      case 'channel.deleted': {
        const { channelId } = event.data;
        this.store.set((s) => ({
          channels: s.channels.filter((c) => c.id !== channelId),
          messages: without(s.messages, channelId),
        }));
        return;
      }

      case 'channel.read':
        this.store.set((s) => ({
          readStates: { ...s.readStates, [event.data.channelId]: event.data.lastReadMessageId },
          mentionCounts: without(s.mentionCounts, event.data.channelId),
        }));
        return;

      case 'error': {
        const { message, ref } = event.data;
        if (ref === 'message.send') {
          // Errors don't carry the nonce; the oldest in-flight message is the one that failed.
          const pending = this.store.get().pending.find((p) => !p.failed);
          if (pending) this.updatePending(pending.nonce, { failed: true });
        }
        showToast(message);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------

  private trySend(pending: PendingMessage): void {
    const sent = this.gateway.send({
      type: 'message.send',
      data: { channelId: pending.channelId, content: pending.content, nonce: pending.nonce },
    });
    if (!sent) this.updatePending(pending.nonce, { failed: true });
  }

  private sendOrWarn(event: Parameters<Gateway['send']>[0]): void {
    if (!this.gateway.send(event)) showToast('Sem conexão com o servidor. Tente de novo.');
  }

  private updatePending(nonce: string, patch: Partial<PendingMessage>): void {
    this.store.set((s) => ({
      pending: s.pending.map((p) => (p.nonce === nonce ? { ...p, ...patch } : p)),
    }));
  }

  private setChannelMessages(channelId: number, value: ChannelMessages): void {
    this.store.set((s) => ({ messages: { ...s.messages, [channelId]: value } }));
  }

  private updateMessages(channelId: number, update: (list: Message[]) => Message[]): void {
    const current = this.store.get().messages[channelId];
    if (current)
      this.setChannelMessages(channelId, { ...current, messages: update(current.messages) });
  }

  private pruneTyping(): void {
    const now = Date.now();
    const { typing } = this.store.get();
    let changed = false;
    const next: ChatState['typing'] = {};
    for (const [channelId, users] of Object.entries(typing)) {
      const alive = Object.fromEntries(Object.entries(users).filter(([, until]) => until > now));
      if (Object.keys(alive).length !== Object.keys(users).length) changed = true;
      if (Object.keys(alive).length) next[Number(channelId)] = alive;
    }
    if (changed) this.store.set({ typing: next });
  }
}
