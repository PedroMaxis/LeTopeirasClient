import { useState, type ReactNode } from 'react';
import { CodeBlock } from '../components/chat/CodeBlock';
import { ExternalLink } from '../components/chat/ExternalLink';
import { linkText, parseHttpUrl } from './links';

/**
 * The bit of Markdown chat messages support, rendered straight to React nodes (never HTML):
 *
 * - blocks: ```code blocks```, `> quotes` (consecutive lines), `# `/`## `/`### ` headings,
 *   `- `/`* `/`1. ` lists (one nested level, 2 spaces) and `-# ` small text; the line blocks
 *   work inside quotes too;
 * - inline: `code`, ||spoiler||, **bold**, ~~strike~~, *italic*, _italic_ and [named](https://links);
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

  // Block level: fenced code first, then quotes and line blocks.
  const fence = /```(?:([\w+#-]{1,20})\n)?([\s\S]*?)```\n?/g;
  let last = 0;
  for (const match of text.matchAll(fence)) {
    const [whole, language, code = ''] = match;
    // The line break before the fence is the block's own.
    renderLines(text.slice(last, match.index).replace(/\n$/, ''));
    out.push(
      <CodeBlock
        key={nextKey()}
        code={code.replace(/^\n/, '').replace(/\n$/, '')}
        language={language}
      />,
    );
    last = match.index + whole.length;
  }
  renderLines(text.slice(last));
  return out;

  function renderLines(chunk: string) {
    if (!chunk) return;
    let run: string[] = [];
    let quoted = false;
    const flush = () => {
      if (run.length === 0) return;
      if (quoted) {
        out.push(
          <blockquote key={nextKey()} className="md-quote">
            {blocks(run)}
          </blockquote>,
        );
      } else out.push(...blocks(run));
      run = [];
    };
    for (const line of chunk.split('\n')) {
      const quote = /^> ?(.*)$/.exec(line);
      if ((quote !== null) !== quoted) flush();
      quoted = quote !== null;
      run.push(quote ? (quote[1] ?? '') : line);
    }
    flush();
  }

  /** Headings, lists and small text; every other line is plain, joined back with its breaks. */
  function blocks(lines: string[]): ReactNode[] {
    const nodes: ReactNode[] = [];
    let plain: string[] = [];
    let items: ListItem[] = [];
    const flushPlain = () => {
      if (plain.length) nodes.push(...inline(plain.join('\n')));
      plain = [];
    };
    const flushList = () => {
      if (items.length) nodes.push(...renderList(items));
      items = [];
    };
    for (const line of lines) {
      const heading = /^(#{1,3}) +(\S.*)$/.exec(line);
      const small = /^-# +(\S.*)$/.exec(line);
      const item = /^( *)([-*]|\d+\.) +(\S.*)$/.exec(line);
      if (item?.[2] !== undefined && item[3] !== undefined) {
        flushPlain();
        items.push({
          nested: (item[1]?.length ?? 0) >= 2,
          ordered: /\d/.test(item[2]),
          start: Number.parseInt(item[2], 10),
          text: item[3],
        });
        continue;
      }
      flushList();
      if (heading?.[1] !== undefined && heading[2] !== undefined) {
        flushPlain();
        nodes.push(
          <div key={nextKey()} className={`md-h${heading[1].length}`}>
            {inline(heading[2])}
          </div>,
        );
      } else if (small?.[1] !== undefined) {
        flushPlain();
        nodes.push(
          <div key={nextKey()} className="md-small">
            {inline(small[1])}
          </div>,
        );
      } else plain.push(line);
    }
    flushList();
    flushPlain();
    return nodes;
  }

  /** Runs of the same kind become one list; a nested item goes under the item before it. */
  function renderList(items: ListItem[]): ReactNode[] {
    const groups: { item: ListItem; children: ListItem[] }[] = [];
    for (const item of items) {
      const previous = groups.at(-1);
      if (item.nested && previous) previous.children.push(item);
      else groups.push({ item, children: [] });
    }
    const lists: ReactNode[] = [];
    for (let i = 0; i < groups.length;) {
      const ordered = groups[i]?.item.ordered ?? false;
      let j = i;
      while (j < groups.length && groups[j]?.item.ordered === ordered) j++;
      const run = groups.slice(i, j);
      lists.push(
        <List key={nextKey()} ordered={ordered} start={run[0]?.item.start}>
          {run.map((g) => (
            <li key={nextKey()}>
              {inline(g.item.text)}
              {g.children.length > 0 && (
                <List ordered={g.children[0]?.ordered ?? false} start={g.children[0]?.start}>
                  {g.children.map((child) => (
                    <li key={nextKey()}>{inline(child.text)}</li>
                  ))}
                </List>
              )}
            </li>
          ))}
        </List>,
      );
      i = j;
    }
    return lists;
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
        case 'link':
          nodes.push(
            <ExternalLink
              key={k}
              href={token.href ?? ''}
              text={linkText(token.inner, token.href ?? '')}
            />,
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

/** Plain-text places (reply quotes, notifications) must not give spoilers away. */
export const hideSpoilers = (text: string) => text.replace(/\|\|[\s\S]+?\|\|/g, '(spoiler)');

/** Spoilers hidden and the block and link markup gone (emphasis markers stay), for one-line previews. */
export const plainText = (text: string) =>
  hideSpoilers(text)
    .replace(/^(?:#{1,3}|-#) +/gm, '')
    .replace(/^ *(?:[-*]|\d+\.) +(?=\S)/gm, '')
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/g, '$1');

interface ListItem {
  nested: boolean;
  ordered: boolean;
  start: number;
  text: string;
}

function List(props: { ordered: boolean; start: number | undefined; children: ReactNode }) {
  return props.ordered ? (
    <ol className="md-list" start={props.start}>
      {props.children}
    </ol>
  ) : (
    <ul className="md-list">{props.children}</ul>
  );
}

type TokenKind = 'code' | 'link' | 'url' | 'mention' | 'spoiler' | 'bold' | 'strike' | 'italic';

interface Token {
  kind: TokenKind;
  index: number;
  /** The whole matched text, markers included. */
  text: string;
  /** What goes inside the element (the URL, the username, the emphasized text). */
  inner: string;
  /** Where a named link goes. */
  href?: string;
}

// Punctuation that usually ends a sentence rather than the URL.
const URL_TRAILING = /[.,!?;:)\]}'"]+$/;

/** Earlier in this list wins when two tokens start at the same index (`**` before `*`). */
const PATTERNS: [TokenKind, RegExp][] = [
  ['code', /`([^`\n]+)`/],
  ['link', /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/],
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
    let href: string | undefined;
    if (kind === 'link') {
      href = match[2];
      if (!href || !parseHttpUrl(href)) continue;
    } else if (kind === 'url') {
      whole = whole.slice(0, whole.length - (URL_TRAILING.exec(whole)?.[0].length ?? 0));
      inner = whole;
    } else if (kind === 'mention') {
      // A trailing dot ends the sentence, not the username.
      inner = inner.replace(/\.+$/, '');
      whole = `@${inner}`;
      if (inner.length < 3) continue;
    }
    best = { kind, index: match.index, text: whole, inner, ...(href ? { href } : {}) };
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
