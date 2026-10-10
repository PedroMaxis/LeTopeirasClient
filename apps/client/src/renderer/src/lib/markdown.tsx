import { useState, type ReactNode } from 'react';

/**
 * The bit of Markdown chat messages support, rendered straight to React nodes (never HTML):
 *
 * - blocks: ```code blocks``` and `> quotes` (consecutive lines);
 * - inline: `code`, ||spoiler||, **bold**, ~~strike~~, *italic* and _italic_;
 * - plus clickable http(s) links and @mentions (`renderMention`).
 *
 * Code is taken literally, links and mentions are atomic (a `_` inside a URL or a username
 * never starts italics), and emphasis can nest.
 */
export function renderMarkdown(
  text: string,
  renderMention: (username: string, key: string) => ReactNode | null = () => null,
): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  const nextKey = () => String(key++);

  // Block level: fenced code first, then quotes line by line.
  const fence = /```(?:([\w+-]{1,20})\n)?([\s\S]*?)```\n?/g;
  let last = 0;
  for (const match of text.matchAll(fence)) {
    const [whole, language, code = ''] = match;
    // The line break before the fence is the block's own.
    renderLines(text.slice(last, match.index).replace(/\n$/, ''));
    out.push(
      <pre key={nextKey()} className="md-codeblock" data-language={language}>
        <code>{code.replace(/^\n/, '').replace(/\n$/, '')}</code>
      </pre>,
    );
    last = match.index + whole.length;
  }
  renderLines(text.slice(last));
  return out;

  function renderLines(chunk: string) {
    if (!chunk) return;
    const lines = chunk.split('\n');
    let plain: string[] = [];
    let quote: string[] = [];
    const flushPlain = () => {
      if (plain.length) out.push(...inline(plain.join('\n')));
      plain = [];
    };
    const flushQuote = () => {
      if (quote.length) {
        out.push(
          <blockquote key={nextKey()} className="md-quote">
            {inline(quote.join('\n'))}
          </blockquote>,
        );
      }
      quote = [];
    };
    for (const line of lines) {
      const quoted = /^> ?(.*)$/.exec(line);
      if (quoted) {
        flushPlain();
        quote.push(quoted[1] ?? '');
      } else {
        flushQuote();
        // Joined back with their line breaks (the message content is pre-wrap).
        plain.push(line);
      }
    }
    flushQuote();
    flushPlain();
  }

  function inline(chunk: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    let rest = chunk;
    while (rest) {
      const token = firstToken(rest);
      if (!token) {
        nodes.push(rest);
        break;
      }
      if (token.index > 0) nodes.push(rest.slice(0, token.index));
      const k = nextKey();
      switch (token.kind) {
        case 'code':
          nodes.push(
            <code key={k} className="md-code">
              {token.inner}
            </code>,
          );
          break;
        case 'url':
          nodes.push(
            <a key={k} href={token.inner} target="_blank" rel="noreferrer">
              {token.inner}
            </a>,
          );
          break;
        case 'mention': {
          const node = renderMention(token.inner.toLowerCase(), k);
          nodes.push(node ?? token.text);
          break;
        }
        case 'spoiler':
          nodes.push(<Spoiler key={k}>{inline(token.inner)}</Spoiler>);
          break;
        case 'bold':
          nodes.push(<strong key={k}>{inline(token.inner)}</strong>);
          break;
        case 'strike':
          nodes.push(<s key={k}>{inline(token.inner)}</s>);
          break;
        case 'italic':
          nodes.push(<em key={k}>{inline(token.inner)}</em>);
          break;
      }
      rest = rest.slice(token.index + token.text.length);
    }
    return nodes;
  }
}

type TokenKind = 'code' | 'url' | 'mention' | 'spoiler' | 'bold' | 'strike' | 'italic';

interface Token {
  kind: TokenKind;
  index: number;
  /** The whole matched text, markers included. */
  text: string;
  /** What goes inside the element (the URL, the username, the emphasized text). */
  inner: string;
}

// Punctuation that usually ends a sentence rather than the URL.
const URL_TRAILING = /[.,!?;:)\]}'"]+$/;

/** Earlier in this list wins when two tokens start at the same index (`**` before `*`). */
const PATTERNS: [TokenKind, RegExp][] = [
  ['code', /`([^`\n]+)`/],
  ['url', /\bhttps?:\/\/[^\s<>"]+/],
  // Same rules as MENTION_PATTERN in @letopeiras/shared.
  ['mention', /(?<![\w.@])@([a-z0-9_.]{3,32})/i],
  ['spoiler', /\|\|([\s\S]+?)\|\|/],
  // Not followed by another `*`: in `**a *b***` the bold closes on the last two.
  ['bold', /\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*(?!\*)/],
  ['strike', /~~(?!\s)([\s\S]+?)(?<!\s)~~/],
  ['italic', /\*(?![\s*])([\s\S]+?)(?<![\s*])\*/],
  // Underscores only around whole words, so snake_case stays as it is.
  ['italic', /(?<![\w])_(?![\s_])([\s\S]+?)(?<![\s_])_(?![\w])/],
];

function firstToken(text: string): Token | null {
  let best: Token | null = null;
  for (const [kind, pattern] of PATTERNS) {
    const match = pattern.exec(text);
    if (!match || (best && match.index >= best.index)) continue;
    let whole = match[0];
    let inner = match[1] ?? whole;
    if (kind === 'url') {
      whole = whole.slice(0, whole.length - (URL_TRAILING.exec(whole)?.[0].length ?? 0));
      inner = whole;
    } else if (kind === 'mention') {
      // A trailing dot ends the sentence, not the username.
      inner = inner.replace(/\.+$/, '');
      whole = `@${inner}`;
      if (inner.length < 3) continue;
    }
    best = { kind, index: match.index, text: whole, inner };
  }
  return best;
}

/** ||hidden|| until clicked. */
function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      className={`md-spoiler ${shown ? 'shown' : ''}`}
      role={shown ? undefined : 'button'}
      title={shown ? undefined : 'Spoiler: clique para ver'}
      onClick={() => setShown(true)}
    >
      {children}
    </span>
  );
}
