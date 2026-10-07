import { useEffect } from 'react';

// A small curated set; the OS emoji panel (Win + .) still works for everything else.
const GROUPS: { label: string; emojis: string }[] = [
  {
    label: 'Carinhas',
    emojis: '😀😃😄😁😆😅😂🤣🙂😉😊😍🥰😘😎🤩🥳😏😴🤔🤨😐🙄😬😮😱😭😢😤😡🤬🤯🥶🥵🤢🤮😇🤡💀👻',
  },
  { label: 'Gestos', emojis: '👍👎👌✌️🤞🤟🤘👊✊👏🙌🙏💪🫡🫶👀🤝👋' },
  { label: 'Coisas', emojis: '❤️🧡💛💚💙💜🖤💔💯🔥✨⭐🎉🎮🕹️🏆⚽🍕🍔🍺☕🎵📺💻⛏️🦔' },
];

interface Props {
  onPick(emoji: string): void;
  onClose(): void;
}

export function EmojiPicker({ onPick, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="context-backdrop" onMouseDown={onClose} />
      <div className="emoji-picker" role="dialog" aria-label="Emojis">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="emoji-group">{group.label.toUpperCase()}</div>
            <div className="emoji-grid">
              {/* Segmenter keeps multi-codepoint emojis (️ variants, ⛏️) in one piece. */}
              {[
                ...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(group.emojis),
              ].map(({ segment }) => (
                <button
                  type="button"
                  key={segment}
                  className="emoji"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(segment)}
                >
                  {segment}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
