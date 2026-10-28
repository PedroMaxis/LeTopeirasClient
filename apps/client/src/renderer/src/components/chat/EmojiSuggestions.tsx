import { useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { LIMITS, type Channel } from '@letopeiras/shared';
import { exactShortcode, searchEmojis, shortcodeQueryAt, type EmojiEntry } from '../../lib/emoji';
import { recordEmojiUse, useEmojiCatalog } from '../../lib/emoji-data';
import { useMentionAutocomplete } from './MentionSuggestions';

const MAX_SUGGESTIONS = 8;

/**
 * ":joy" autocomplete for a textarea, with the same wiring as `useMentionAutocomplete`.
 * Inserts the emoji itself (not the shortcode); typing the closing colon of an exact shortcode
 * swaps it too.
 */
function useEmojiAutocomplete(options: {
  value: string;
  setValue(value: string): void;
  input: RefObject<HTMLTextAreaElement | null>;
}) {
  const { value, setValue, input } = options;
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState({ query: '', index: 0 });
  /** Where Esc closed the list, so it stays closed for that ":". */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const typed = shortcodeQueryAt(value, cursor);
  // Starts fetching the data the first time a ":xx" is typed.
  const catalog = useEmojiCatalog(typed !== null);
  const active = typed && !typed.closed && typed.start !== dismissedAt ? typed : null;
  const activeQuery = active?.query ?? null;
  const candidates =
    catalog && activeQuery ? searchEmojis(catalog, activeQuery, MAX_SUGGESTIONS) : [];
  const open = active !== null && candidates.length > 0;
  const index =
    selected.query === active?.query ? Math.min(selected.index, candidates.length - 1) : 0;

  const replace = (start: number, end: number, emoji: string, text = value) => {
    const insert = `${emoji} `;
    const caret = start + insert.length;
    setValue((text.slice(0, start) + insert + text.slice(end)).slice(0, LIMITS.messageMax));
    setCursor(caret);
    recordEmojiUse(emoji);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  };

  const pick = (entry: EmojiEntry) => {
    if (active) replace(active.start, cursor, entry.emoji);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || !active) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setSelected({
        query: active.query,
        index: (index + delta + candidates.length) % candidates.length,
      });
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const entry = candidates[index];
      if (entry) pick(entry);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissedAt(active.start);
      return true;
    }
    return false;
  };

  const popover: ReactNode = open ? (
    <div className="mention-suggestions" role="listbox" aria-label="Emojis">
      <div className="emoji-group">EMOJIS</div>
      {candidates.map((entry, i) => (
        <button
          type="button"
          role="option"
          aria-selected={i === index}
          key={entry.emoji}
          className={`mention-option ${i === index ? 'selected' : ''}`}
          // Keep the focus in the text box.
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => active && setSelected({ query: active.query, index: i })}
          onClick={() => pick(entry)}
        >
          <span className="emoji-suggestion-glyph">{entry.emoji}</span>
          <span className="mention-option-name">:{entry.shortcodes[0] ?? entry.name}:</span>
          <span className="mention-option-username">{entry.name}</span>
        </button>
      ))}
    </div>
  ) : null;

  return {
    popover,
    onKeyDown,
    trackCursor: (el: HTMLTextAreaElement) => {
      setCursor(el.selectionStart);
      const closed = shortcodeQueryAt(el.value, el.selectionStart);
      if (!closed?.closed || !catalog) return;
      const exact = exactShortcode(catalog, closed.query);
      if (exact) replace(closed.start, el.selectionStart, exact.emoji, el.value);
    },
    reset: () => {
      setCursor(0);
      setDismissedAt(null);
    },
  };
}

/** @mentions and :emojis for one textarea; the two can't be open at once (different triggers). */
export function useTextAutocomplete(options: {
  channel: Channel;
  value: string;
  setValue(value: string): void;
  input: RefObject<HTMLTextAreaElement | null>;
}) {
  const mentions = useMentionAutocomplete(options);
  const emojis = useEmojiAutocomplete(options);
  return {
    popover: mentions.popover ?? emojis.popover,
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) =>
      mentions.onKeyDown(e) || emojis.onKeyDown(e),
    trackCursor: (el: HTMLTextAreaElement) => {
      mentions.trackCursor(el);
      emojis.trackCursor(el);
    },
    reset: () => {
      mentions.reset();
      emojis.reset();
    },
  };
}
