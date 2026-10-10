import type { Channel, Message, User } from '@letopeiras/shared';
import { hideSpoilers } from './markdown';
import { settings } from './settings';
import { playSound } from './sounds';

/** Window event the layout listens to, to open a channel from a notification click. */
export const OPEN_CHANNEL_EVENT = 'letopeiras:open-channel';

const MAX_BODY = 140;

/**
 * Windows toast for a new message. Mentions always notify unless we're looking at that
 * channel; other messages only when the app isn't focused and "all messages" is on.
 */
export function notifyMessage(
  message: Message,
  author: User | undefined,
  channel: Channel,
  /** `direct`: @you by name (otherwise only @todos). */
  context: { mentionsMe: boolean; direct: boolean; viewing: boolean },
): void {
  const { notifications, notifyAll } = settings.get();
  if (!notifications) return;
  const focused = document.hasFocus();
  // A mention also flashes the taskbar button until the window gets focus.
  if (context.mentionsMe && !focused) void window.api.flashWindow();
  const notify = context.mentionsMe ? !(focused && context.viewing) : notifyAll && !focused;
  if (!notify) return;
  const text = hideSpoilers(message.content);
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
