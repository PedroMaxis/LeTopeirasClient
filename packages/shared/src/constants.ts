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
  /** Different emojis on one message (adding one that's already there is always fine). */
  reactionsPerMessage: 20,
  /** Characters of the original message quoted in a reply. */
  replySnippetMax: 200,
  searchPageDefault: 25,
  searchPageMax: 50,
  /** Images per message, and the size of each before compression. */
  attachmentsPerMessage: 4,
  attachmentMaxBytes: 10 * 1024 * 1024,
  avatarMaxBytes: 25 * 1024 * 1024,
  /** Songs waiting in a voice room's queue (the one playing isn't counted). */
  musicQueue: 50,
  musicSearchMax: 200,
} as const;

// One emoji: pictographs plus the joiners, variation selectors, skin tones and keycaps that
// build composite ones (👍🏽, ❤️, 👨‍👩‍👧, 1️⃣), or a flag (two regional indicators, or 🏴 plus tag characters for England, Scotland and Wales).
const EMOJI_PATTERN =
  /^(?:(?:\p{Extended_Pictographic}|[#*0-9]\uFE0F?\u20E3)(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*|\p{Regional_Indicator}{2}|🏴[󠀠-󠁾]+󠁿)$/u;

/** Whether `text` is a single emoji, as reactions require. */
export function isReactionEmoji(text: string): boolean {
  return text.length <= 32 && EMOJI_PATTERN.test(text);
}

/**
 * The video id of a YouTube link (watch, youtu.be, shorts, embed, live, music.youtube.com),
 * or null for anything else.
 */
export function parseYouTubeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (host === 'youtube.com') {
    id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : (/^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? null);
  }
  return id && /^[\w-]{6,20}$/.test(id) ? id : null;
}

/** A Spotify track link (open.spotify.com/track/…), which only helps to find the song's title. */
export function isSpotifyTrackUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'open.spotify.com' &&
      /^\/(?:intl-[\w-]+\/)?track\/\w+/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

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
