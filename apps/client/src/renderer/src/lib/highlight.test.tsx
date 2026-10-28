import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { highlight } from './highlight';

const html = (code: string, language: string) =>
  renderToStaticMarkup(<>{highlight(code, language)}</>);

describe('highlight', () => {
  it('colors known languages and their aliases', () => {
    expect(html('const a = 1;', 'js')).toContain('<span class="hljs-keyword">const</span>');
    expect(html('def f(): pass', 'python')).toContain('hljs-keyword');
    expect(html('SELECT 1', 'sql')).toContain('hljs-keyword');
    expect(html('Get-Item', 'ps1')).not.toBe('');
    expect(highlight('x', 'c++')).not.toBeNull();
    expect(highlight('x', 'c#')).not.toBeNull();
  });

  it('never turns text into markup', () => {
    expect(html('<img src=x onerror=1>', 'html')).not.toContain('<img');
  });

  it('returns null for unknown languages', () => {
    expect(highlight('x', 'brainfuck')).toBeNull();
  });
});
