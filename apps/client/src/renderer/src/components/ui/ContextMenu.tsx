import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/** One line of a right-click menu. */
export type MenuEntry =
  | {
      label: string;
      /** `shift`: Shift was held, e.g. to delete without asking. */
      onSelect(shift: boolean): void;
      danger?: boolean;
      disabled?: boolean;
      /** Small text on the right ("Shift apaga direto"). */
      hint?: string | undefined;
    }
  | { title: string }
  | { separator: true }
  /** Anything else (reaction row, volume sliders); `close` dismisses the menu. */
  | { key: string; render(close: () => void): ReactNode };

/** Falsy entries are skipped, so lists can use `condition && entry` (even with a string). */
export type MenuEntries = (MenuEntry | false | '' | null | undefined)[];

const EDGE = 8;

/**
 * A right-click menu: `open(event, entries)` from an `onContextMenu` handler, and render
 * `menu`. It stays inside the window (flips up/left when it doesn't fit), ↑/↓ and Enter work,
 * and Esc, a click outside, scrolling, resizing or leaving the window close it.
 */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const close = useCallback(() => setState(null), []);

  const open = (event: MouseEvent, entries: MenuEntries) => {
    event.preventDefault();
    event.stopPropagation();
    const shown = entries.filter((e): e is MenuEntry => Boolean(e));
    if (shown.length > 0) setState({ x: event.clientX, y: event.clientY, entries: shown });
  };

  const menu = state ? <ContextMenu {...state} onClose={close} /> : null;
  return { open, close, menu };
}

function ContextMenu(props: { x: number; y: number; entries: MenuEntry[]; onClose(): void }) {
  const { x, y, entries, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);

  // Placed after measuring, straight on the element (no state update in an effect).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = x + width > window.innerWidth - EDGE ? Math.max(EDGE, x - width) : x;
    const top =
      y + height > window.innerHeight - EDGE
        ? Math.max(EDGE, Math.min(y - height, window.innerHeight - EDGE - height))
        : y;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = 'visible';
    el.focus();
  }, [x, y]);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('.context-item:not(:disabled)') ?? []),
    ];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = current === -1 ? (step === 1 ? 0 : items.length - 1) : current + step;
    items[(next + items.length) % items.length]?.focus();
  };

  return createPortal(
    <div
      className="context-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        className="context-menu list"
        role="menu"
        tabIndex={-1}
        style={{ left: x, top: y, visibility: 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {entries.map((entry, i) => {
          if ('separator' in entry) return <div key={i} className="context-separator" />;
          if ('title' in entry) {
            return (
              <div key={i} className="context-title">
                {entry.title}
              </div>
            );
          }
          if ('render' in entry) return <div key={entry.key}>{entry.render(onClose)}</div>;
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={`context-item ${entry.danger ? 'danger' : ''}`}
              disabled={entry.disabled}
              onClick={(e) => {
                onClose();
                entry.onSelect(e.shiftKey);
              }}
            >
              <span>{entry.label}</span>
              {entry.hint && <span className="context-hint">{entry.hint}</span>}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
