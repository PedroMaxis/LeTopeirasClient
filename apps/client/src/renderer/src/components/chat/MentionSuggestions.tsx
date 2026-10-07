import { useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { EVERYONE_MENTION, LIMITS, type Channel, type User } from '@letopeiras/shared';
import { canAccess, nameColor } from '../../lib/roles';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';

const MAX_SUGGESTIONS = 8;

type Candidate = { kind: 'everyone' } | { kind: 'user'; user: User };

/** Lowercase without accents, so "joa" finds "João". */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** The "@que" being typed right before the cursor, if any. */
export function mentionQueryAt(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const match = /(?:^|[^\w.@])@([\w.]{0,32})$/u.exec(text.slice(0, cursor));
  if (match?.[1] === undefined) return null;
  return { start: cursor - match[1].length - 1, query: match[1] };
}

/** @todos (if it matches) and the people who can see the channel, best matches first. */
function useCandidates(channel: Channel, query: string | null): Candidate[] {
  const { chat } = useSession();
  const users = useStore(chat.store, (s) => s.users);
  const presence = useStore(chat.store, (s) => s.presence);
  const meId = useStore(chat.store, (s) => s.me?.id);
  if (query === null) return [];

  const q = normalize(query);
  const score = (user: User) => {
    const names = [normalize(user.username), normalize(user.displayName)];
    if (names.some((n) => n.startsWith(q))) return 0;
    if (names.some((n) => n.includes(q))) return 1;
    return -1;
  };
  const people = Object.values(users)
    .filter((user) => user.id !== meId && canAccess(user, channel) && score(user) >= 0)
    .sort(
      (a, b) =>
        score(a) - score(b) ||
        Number(presence.has(b.id)) - Number(presence.has(a.id)) ||
        a.displayName.localeCompare(b.displayName, 'pt-BR'),
    )
    .map((user): Candidate => ({ kind: 'user', user }));
  const everyone: Candidate[] = EVERYONE_MENTION.startsWith(q) ? [{ kind: 'everyone' }] : [];
  return [...everyone, ...people].slice(0, MAX_SUGGESTIONS);
}

/**
 * @mention autocomplete for a textarea. Wire `onChange`/`onSelect`/`onKeyDown` into it and
 * render `popover` inside a positioned container. `onKeyDown` returns true when it used the key.
 */
export function useMentionAutocomplete(options: {
  channel: Channel;
  value: string;
  setValue(value: string): void;
  input: RefObject<HTMLTextAreaElement | null>;
}) {
  const { channel, value, setValue, input } = options;
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState({ query: '', index: 0 });
  /** Where Esc closed the list, so it stays closed for that "@". */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const typed = mentionQueryAt(value, cursor);
  const mention = typed && typed.start !== dismissedAt ? typed : null;
  const candidates = useCandidates(channel, mention?.query ?? null);
  const open = mention !== null && candidates.length > 0;
  const index =
    selected.query === mention?.query ? Math.min(selected.index, candidates.length - 1) : 0;

  const pick = (candidate: Candidate) => {
    if (!mention) return;
    const name = candidate.kind === 'everyone' ? EVERYONE_MENTION : candidate.user.username;
    const insert = `@${name} `;
    const caret = mention.start + insert.length;
    const next = value.slice(0, mention.start) + insert + value.slice(cursor);
    setValue(next.slice(0, LIMITS.messageMax));
    setCursor(caret);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || !mention) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setSelected({
        query: mention.query,
        index: (index + delta + candidates.length) % candidates.length,
      });
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const candidate = candidates[index];
      if (candidate) pick(candidate);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissedAt(mention.start);
      return true;
    }
    return false;
  };

  const popover: ReactNode = open ? (
    <MentionSuggestions
      candidates={candidates}
      selected={index}
      onPick={pick}
      onHover={(i) => mention && setSelected({ query: mention.query, index: i })}
    />
  ) : null;

  return {
    popover,
    onKeyDown,
    /** Call from the textarea's onChange and onSelect so the "@" under the cursor is known. */
    trackCursor: (el: HTMLTextAreaElement) => setCursor(el.selectionStart),
    reset: () => {
      setCursor(0);
      setDismissedAt(null);
    },
  };
}

function MentionSuggestions(props: {
  candidates: Candidate[];
  selected: number;
  onPick(candidate: Candidate): void;
  onHover(index: number): void;
}) {
  const { chat } = useSession();
  const roles = useStore(chat.store, (s) => s.roles);
  return (
    <div className="mention-suggestions" role="listbox" aria-label="Marcar alguém">
      <div className="emoji-group">MEMBROS</div>
      {props.candidates.map((candidate, index) => (
        <button
          type="button"
          role="option"
          aria-selected={index === props.selected}
          key={candidate.kind === 'everyone' ? 'everyone' : candidate.user.id}
          className={`mention-option ${index === props.selected ? 'selected' : ''}`}
          // Keep the focus in the text box.
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => props.onHover(index)}
          onClick={() => props.onPick(candidate)}
        >
          {candidate.kind === 'everyone' ? (
            <>
              <span className="mention-everyone-icon">
                <Icon name="members" size={16} />
              </span>
              <span className="mention-option-name">@{EVERYONE_MENTION}</span>
              <span className="mention-option-username">avisa todo mundo que vê o canal</span>
            </>
          ) : (
            <>
              <Avatar user={candidate.user} size={24} />
              <span
                className="mention-option-name"
                style={{ color: nameColor(candidate.user, roles) }}
              >
                {candidate.user.displayName}
              </span>
              <span className="mention-option-username">@{candidate.user.username}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
