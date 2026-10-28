import type { Channel, Message, User } from '@letopeiras/shared';
import { hideSpoilers } from './markdown';
import { settings } from './settings';
import { playSound } from './sounds';

/** Window event the layout listens to, to open a channel from a notification click. */
export const OPEN_CHANNEL_EVENT = 'letopeiras:open-channel';

const MAX_BODY = 140;

export type ChannelNotify = 'all' | 'mentions' | 'none';

/** What a new message from someone else triggers. */
export interface NotifyDecision {
  /** Windows toast plus the message sound. */
  toast: boolean;
  /** Flash the taskbar button until the window gets focus. */
  flash: boolean;
}

/**
 * Pure rule. "Nada" on a channel and "Não perturbe" silence everything (mentions too); otherwise
 * mentions notify unless we're looking at that channel, and other messages only when the app isn't
 * focused and the channel's mode (or, without one, the general `notifyAll`) is "all".
 */
export function decideNotify(input: {
  notifications: boolean;
  notifyAll: boolean;
  doNotDisturb: boolean;
  /** The channel's own choice, if any. */
  channelMode: ChannelNotify | undefined;
  mentionsMe: boolean;
  focused: boolean;
  viewing: boolean;
}): NotifyDecision {
  const none: NotifyDecision = { toast: false, flash: false };
  if (!input.notifications || input.doNotDisturb || input.channelMode === 'none') return none;
  const flash = input.mentionsMe && !input.focused;
  if (input.mentionsMe) return { toast: !(input.focused && input.viewing), flash };
  const all = input.channelMode ? input.channelMode === 'all' : input.notifyAll;
  return { toast: all && !input.focused, flash };
}

/** Unread mentions that count for the taskbar badge: channels set to "Nada" don't. */
export function badgeMentions(
  mentionCounts: Record<number, number>,
  channelNotify: Record<string, ChannelNotify>,
): number {
  return Object.entries(mentionCounts).reduce(
    (sum, [id, n]) => (channelNotify[id] === 'none' ? sum : sum + n),
    0,
  );
}

/**
 * Windows toast for a new message (see `decideNotify`).
 */
export function notifyMessage(
  message: Message,
  author: User | undefined,
  channel: Channel,
  /** `direct`: @you by name (otherwise only @todos). */
  context: { mentionsMe: boolean; direct: boolean; viewing: boolean },
): void {
  const { notifications, notifyAll, doNotDisturb, channelNotify } = settings.get();
  const focused = document.hasFocus();
  const { toast, flash } = decideNotify({
    notifications,
    notifyAll,
    doNotDisturb,
    channelMode: channelNotify[channel.id],
    mentionsMe: context.mentionsMe,
    focused,
    viewing: context.viewing,
  });
  if (flash) void window.api.flashWindow();
  if (!toast) return;
  // An image-only message has no text to show.
  const text = hideSpoilers(message.content) || '📷 Imagem';
  const body = text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…` : text;
  const who = author?.displayName ?? 'Alguém';
  const title = !context.mentionsMe
    ? `${who} em #${channel.name}`
    : context.direct
      ? `${who} marcou você em #${channel.name}`
      : `${who} chamou @todos em #${channel.name}`;
  const notification = new Notification(title, {
    body,
    // One toast per channel: a burst of messages replaces instead of stacking.
    tag: `channel-${channel.id}`,
    silent: true,
  });
  playSound('message');
  notification.onclick = () => {
    void window.api.showWindow();
    window.dispatchEvent(new CustomEvent(OPEN_CHANNEL_EVENT, { detail: channel.id }));
    notification.close();
  };
}
