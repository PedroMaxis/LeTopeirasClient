/**
 * Window event asking the message list of `channelId` to scroll to `messageId` (reply quotes,
 * search results), loading older pages until it's there. Detail: { channelId, messageId }.
 */
export const JUMP_TO_MESSAGE_EVENT = 'letopeiras:jump-to-message';

export interface JumpToMessage {
  channelId: number;
  messageId: number;
}

export function jumpToMessage(target: JumpToMessage): void {
  window.dispatchEvent(new CustomEvent(JUMP_TO_MESSAGE_EVENT, { detail: target }));
}
