import type { Store } from './store';

const SIZE = 32;
const DANGER = '#d9412f'; // --danger

/** "1"…"9", then "9+" (more digits don't fit in a 16 px overlay). */
const label = (count: number) => (count > 9 ? '9+' : String(count));

/** A red dot with the count in white, as a PNG data URL (the taskbar overlay icon). */
function drawBadge(count: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = DANGER;
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  ctx.fill();
  const text = label(count);
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${text.length > 1 ? 17 : 22}px 'Figtree Variable', 'Segoe UI', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, SIZE / 2, SIZE / 2 + 1);
  return canvas.toDataURL('image/png');
}

/**
 * Keeps the taskbar button's overlay in sync with the unread mentions (all channels).
 * Returns the cleanup, which also removes the overlay (logout).
 */
export function syncTaskbarBadge(
  store: Store<{ mentionCounts: Record<number, number> }>,
): () => void {
  let shown = 0;
  const update = () => {
    const total = Object.values(store.get().mentionCounts).reduce((sum, n) => sum + n, 0);
    if (total === shown) return;
    shown = total;
    const description = total === 1 ? '1 marcação' : `${total} marcações`;
    void window.api.setTaskbarBadge(total > 0 ? drawBadge(total) : null, description);
  };
  update();
  const unsubscribe = store.subscribe(update);
  return () => {
    unsubscribe();
    if (shown > 0) void window.api.setTaskbarBadge(null, '');
  };
}
