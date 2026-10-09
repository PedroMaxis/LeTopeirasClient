import type { ReactNode } from 'react';

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const full = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
const long = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' });

const startOfDay = (ts: number) => new Date(ts).setHours(0, 0, 0, 0);

/** "Hoje às 21:02", "Ontem às 09:15" or "03/10/2026 21:02". */
export function formatTimestamp(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (days === 0) return `Hoje às ${time.format(ts)}`;
  if (days === 1) return `Ontem às ${time.format(ts)}`;
  return `${date.format(ts)} ${time.format(ts)}`;
}

/** "Hoje", "Ontem" or "8 de outubro de 2026", for the divider between days. */
export function formatDay(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return long.format(ts);
}

export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);

export const formatTime = (ts: number) => time.format(ts);
export const formatFull = (ts: number) => full.format(ts);

// A URL, or an @mention (same rules as MENTION_PATTERN in @letopeiras/shared).
const TOKEN_PATTERN = /(\bhttps?:\/\/[^\s<>"]+)|(?<![\w.@])@([a-z0-9_.]{3,32})/gi;
// Punctuation that usually ends a sentence rather than the URL or the name.
const TRAILING = /[.,!?;:)\]}'"]+$/;

/**
 * Message text with clickable http(s) links (they open in the default browser, see
 * main/index.ts) and @mentions rendered by `renderMention` (return null to keep the text).
 */
export function renderContent(
  text: string,
  renderMention: (username: string, key: number) => ReactNode | null = () => null,
): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const [whole, url, username] = match;
    const start = match.index;
    let token = whole;
    let node: ReactNode | null = null;
    if (url) {
      token = url.slice(0, url.length - (TRAILING.exec(url)?.[0].length ?? 0));
      node = (
        <a key={start} href={token} target="_blank" rel="noreferrer">
          {token}
        </a>
      );
    } else if (username) {
      const name = username.replace(/\.+$/, '');
      token = `@${name}`;
      node = renderMention(name.toLowerCase(), start);
    }
    if (!node) continue;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(node);
    last = start + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
