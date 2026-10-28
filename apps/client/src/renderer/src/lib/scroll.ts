/** A message in view and how far its top is from the top of the list (negative: partly above). */
export interface ScrollAnchor {
  messageId: number;
  offset: number;
}

/** Vertical position of a rendered message, in the same coordinates as the list's top. */
export interface MessageBox {
  id: number;
  top: number;
  bottom: number;
}

/** The first message that reaches into the visible area, in order, or null when none does. */
export function anchorAt(items: MessageBox[], containerTop: number): ScrollAnchor | null {
  const first = items.find((item) => item.bottom > containerTop);
  return first ? { messageId: first.id, offset: first.top - containerTop } : null;
}

/** How much to scroll so an anchor currently at `top` ends up `offset` below the list's top. */
export const scrollDeltaToAnchor = (top: number, containerTop: number, anchor: ScrollAnchor) =>
  top - containerTop - anchor.offset;
