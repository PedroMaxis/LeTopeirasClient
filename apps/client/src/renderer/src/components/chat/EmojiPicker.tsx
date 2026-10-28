import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EMOJI_GROUPS, searchEmojis, type EmojiEntry } from '../../lib/emoji';
import { recordEmojiUse, useEmojiCatalog, useFrequentEmojis } from '../../lib/emoji-data';

const FREQUENT_COUNT = 24;
const GROUP_ICONS = ['😀', '🧑', '🐻', '🍔', '🚗', '⚽', '💡', '🔣', '🏁'];

interface Props {
  onPick(emoji: string): void;
  onClose(): void;
  /** Overrides the default placement (above the composer's button). */
  style?: CSSProperties | undefined;
}

interface Section {
  key: string;
  label: string;
  icon: string;
  entries: EmojiEntry[];
}

export function EmojiPicker({ onPick, onClose, style }: Props) {
  const catalog = useEmojiCatalog();
  const frequent = useFrequentEmojis(FREQUENT_COUNT);
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const byEmoji = useMemo(() => new Map(catalog?.map((e) => [e.emoji, e])), [catalog]);

  const sections = useMemo<Section[]>(() => {
    if (!catalog) return [];
    const trimmed = query.trim();
    if (trimmed) {
      return [
        { key: 'search', label: 'RESULTADOS', icon: '🔍', entries: searchEmojis(catalog, trimmed) },
      ];
    }
    const used = frequent.flatMap((emoji) => byEmoji.get(emoji) ?? []);
    const groups = EMOJI_GROUPS.map((label, group): Section => ({
      key: label,
      label: label.toUpperCase(),
      icon: GROUP_ICONS[group] ?? '🙂',
      entries: catalog.filter((e) => e.group === group),
    }));
    return used.length > 0
      ? [{ key: 'frequent', label: 'FREQUENTES', icon: '🕒', entries: used }, ...groups]
      : groups;
  }, [catalog, byEmoji, frequent, query]);

  const pick = (entry: EmojiEntry) => {
    recordEmojiUse(entry.emoji);
    onPick(entry.emoji);
  };

  const jumpTo = (key: string) => {
    const box = scroller.current;
    const target = box?.querySelector<HTMLElement>(`[data-section="${key}"]`);
    if (box && target) box.scrollTop = target.offsetTop - box.offsetTop;
  };

  const first = query.trim() ? sections[0]?.entries[0] : undefined;

  return (
    <>
      <div className="context-backdrop" onMouseDown={onClose} />
      <div className="emoji-picker" role="dialog" aria-label="Emojis" style={style}>
        <input
          className="input emoji-search"
          placeholder="Buscar emoji"
          aria-label="Buscar emoji"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && first) {
              e.preventDefault();
              pick(first);
            }
          }}
        />
        {!query.trim() && (
          <div className="emoji-tabs">
            {sections.map((section) => (
              <button
                type="button"
                key={section.key}
                className="emoji-tab"
                title={section.label.charAt(0) + section.label.slice(1).toLowerCase()}
                onClick={() => jumpTo(section.key)}
              >
                {section.icon}
              </button>
            ))}
          </div>
        )}
        <div className="emoji-scroll" ref={scroller}>
          {!catalog && <div className="emoji-empty">Carregando…</div>}
          {catalog && query.trim() && sections[0]?.entries.length === 0 && (
            <div className="emoji-empty">Nenhum emoji encontrado.</div>
          )}
          {sections.map(
            (section) =>
              section.entries.length > 0 && (
                <div key={section.key} data-section={section.key} className="emoji-section">
                  <div className="emoji-group">{section.label}</div>
                  <div className="emoji-grid">
                    {section.entries.map((entry) => (
                      <button
                        type="button"
                        key={entry.emoji}
                        className="emoji"
                        aria-label={entry.name}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHovered(entry)}
                        onClick={() => pick(entry)}
                      >
                        {entry.emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ),
          )}
        </div>
        <div className="emoji-footer">
          {hovered ? (
            <>
              <span className="emoji-footer-emoji">{hovered.emoji}</span>
              <span className="emoji-footer-name">{hovered.name}</span>
              {hovered.shortcodes[0] && (
                <span className="emoji-footer-code">:{hovered.shortcodes[0]}:</span>
              )}
            </>
          ) : (
            <span className="emoji-footer-name">Passe o mouse para ver o nome</span>
          )}
        </div>
      </div>
    </>
  );
}
