import { useEffect, useMemo, useState } from 'react';
import {
  buildCatalog,
  quickReactions,
  recordUse,
  topEmojis,
  type EmojiEntry,
  type EmojiUsage,
  type RawEmoji,
  type RawShortcodes,
} from './emoji';
import { Store, useStore } from './store';

let loading: Promise<EmojiEntry[]> | null = null;

/** The whole catalog, in its own chunk, fetched the first time anything needs it. */
export function loadEmojiCatalog(): Promise<EmojiEntry[]> {
  loading ??= Promise.all([
    import('emojibase-data/pt/compact.json'),
    import('emojibase-data/en/shortcodes/github.json'),
  ]).then(([compact, github]) =>
    buildCatalog(compact.default as RawEmoji[], github.default as RawShortcodes),
  );
  // A failed load (it shouldn't, the files are bundled) can be retried on the next use.
  loading.catch(() => (loading = null));
  return loading;
}

/** The catalog once loaded (null before). Pass `false` to not start loading yet. */
export function useEmojiCatalog(enabled = true): EmojiEntry[] | null {
  const [catalog, setCatalog] = useState<EmojiEntry[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadEmojiCatalog().then(
      (loaded) => !cancelled && setCatalog(loaded),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return catalog;
}

/* ------------------------------------------------------------- frequency */

const USAGE_KEY = 'letopeiras.emojiUsage';

function readUsage(): EmojiUsage {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return {};
    const usage: EmojiUsage = {};
    for (const [emoji, use] of Object.entries(parsed)) {
      const { count, last } = (use ?? {}) as { count?: unknown; last?: unknown };
      if (typeof count === 'number' && typeof last === 'number') usage[emoji] = { count, last };
    }
    return usage;
  } catch {
    return {};
  }
}

const usageStore = new Store<{ usage: EmojiUsage; now: number }>({
  usage: readUsage(),
  now: Date.now(),
});

/** Call whenever an emoji is picked (reaction or composer). */
export function recordEmojiUse(emoji: string): void {
  const now = Date.now();
  const usage = recordUse(usageStore.get().usage, emoji, now);
  usageStore.set({ usage, now });
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    // Frequent emojis just won't persist.
  }
}

/** The `limit` most used emojis (empty until something was used). */
// `now` is refreshed on every use, which is often enough for a decay measured in days.
export function useFrequentEmojis(limit: number): string[] {
  const usage = useStore(usageStore, (s) => s.usage);
  const now = useStore(usageStore, (s) => s.now);
  return useMemo(() => topEmojis(usage, now, limit), [usage, now, limit]);
}

/** `size` emojis for the quick reaction spots: the most used, topped up with the defaults. */
export function useQuickReactions(size: number): string[] {
  const usage = useStore(usageStore, (s) => s.usage);
  const now = useStore(usageStore, (s) => s.now);
  return useMemo(() => quickReactions(usage, now, size), [usage, now, size]);
}
