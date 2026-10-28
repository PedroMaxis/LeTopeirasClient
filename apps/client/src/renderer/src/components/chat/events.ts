/**
 * Window event asking the message list of `channelId` to scroll to `messageId` (reply quotes,
 * search results), loading older pages until it's there. Detail: { channelId, messageId }.
 */
export const JUMP_TO_MESSAGE_EVENT = 'letopeiras:jump-to-message';

export interface JumpToMessage {
  channelId: number;
  messageId: number;
}

/** A jump to a channel whose list isn't mounted yet (opened from a search result). */
let pendingJump: JumpToMessage | null = null;

export function jumpToMessage(target: JumpToMessage): void {
  pendingJump = target;
  window.dispatchEvent(new CustomEvent(JUMP_TO_MESSAGE_EVENT, { detail: target }));
}

/** Whether a jump to this channel is waiting (the list then scrolls there, not to a saved spot). */
export const hasPendingJump = (channelId: number) => pendingJump?.channelId === channelId;

/** The list that handles a jump (now or when it mounts) takes it, so it runs once. */
export function takePendingJump(channelId: number): JumpToMessage | null {
  if (pendingJump?.channelId !== channelId) return null;
  const jump = pendingJump;
  pendingJump = null;
  return jump;
}
