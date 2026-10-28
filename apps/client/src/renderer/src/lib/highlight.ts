import { createElement, type ReactNode } from 'react';
import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import lua from 'highlight.js/lib/languages/lua';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

// Loaded on demand (components/chat/CodeBlock.tsx), so none of this is in the startup bundle.
const lowlight = createLowlight({
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  java,
  javascript,
  json,
  lua,
  powershell,
  python,
  sql,
  typescript,
  xml,
});
lowlight.registerAlias({ bash: ['shell', 'zsh'], powershell: ['pwsh'], xml: ['svg'] });

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

// The tree becomes React elements; text is never turned into HTML.
function toReact(nodes: HastNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    if (node.type === 'text') return node.value ?? '';
    if (node.type !== 'element') return null;
    const className = Array.isArray(node.properties?.className)
      ? node.properties.className.join(' ')
      : undefined;
    return createElement('span', { key: i, className }, ...toReact(node.children ?? []));
  });
}

/** Colored nodes for `code`, or null when the language isn't one we know. */
export function highlight(code: string, language: string): ReactNode[] | null {
  const name = language.toLowerCase();
  if (!lowlight.registered(name)) return null;
  return toReact(lowlight.highlight(name, code).children as HastNode[]);
}
