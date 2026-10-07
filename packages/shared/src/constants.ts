export const APP_NAME = 'LeTopeiras Client';
export const APP_ID = 'com.letopeiras.client';

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 32,
  displayNameMax: 32,
  passwordMin: 8,
  passwordMax: 128,
  channelNameMax: 64,
  channelTopicMax: 256,
  categoryNameMax: 64,
  roleNameMax: 32,
  messageMax: 2000,
  historyPageDefault: 50,
  historyPageMax: 100,
} as const;

/** LiveKit room name for a voice channel. */
export const voiceRoomName = (channelId: number): string => `voice:${channelId}`;

export function parseVoiceRoomName(roomName: string): number | null {
  const match = /^voice:(\d+)$/.exec(roomName);
  return match ? Number(match[1]) : null;
}

/**
 * `@username` in message text. The lookbehind keeps e-mails (a@b.com) from matching; the
 * username rules match `usernameSchema`. Group 1 is the username.
 */
export const MENTION_PATTERN = /(?<![\w.@])@([a-z0-9_.]{3,32})/gi;

/** `@todos` notifies everyone who can see the channel; nobody can take it as a username. */
export const EVERYONE_MENTION = 'todos';

function mentionedNames(content: string): Set<string> {
  const names = new Set<string>();
  for (const match of content.matchAll(MENTION_PATTERN)) {
    // A trailing dot is punctuation ("fala @maria."), not part of the name.
    const name = match[1]?.toLowerCase().replace(/\.+$/, '');
    if (name && name.length >= 3) names.add(name);
  }
  return names;
}

/** Usernames mentioned in a message, lowercased and without duplicates (not `@todos`). */
export function parseMentions(content: string): string[] {
  return [...mentionedNames(content)].filter((name) => name !== EVERYONE_MENTION);
}

/** Whether the message uses `@todos`. */
export function mentionsEveryone(content: string): boolean {
  return mentionedNames(content).has(EVERYONE_MENTION);
}

/** How long a "typing…" indicator stays visible without a new typing.start. */
export const TYPING_TIMEOUT_MS = 8000;

/** Close codes the server uses on the WebSocket. */
export const WsCloseCode = {
  Unauthorized: 4001,
  AuthTimeout: 4002,
  SessionRevoked: 4003,
  InvalidMessage: 4004,
  /** Too many sockets from one IP still waiting to authenticate; the client retries later. */
  TooManyConnections: 4005,
} as const;
