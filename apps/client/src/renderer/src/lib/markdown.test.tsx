import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hideSpoilers, renderMarkdown } from './markdown';

const html = (text: string) =>
  renderToStaticMarkup(
    <>
      {renderMarkdown(text, (username) => (
        <b className="mention">@{username}</b>
      ))}
    </>,
  );

describe('renderMarkdown', () => {
  it('leaves plain text alone', () => {
    expect(html('oi tudo bem?\nlinha 2')).toBe('oi tudo bem?\nlinha 2');
  });

  it('escapes HTML instead of rendering it', () => {
    expect(html('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders emphasis, strike and inline code', () => {
    expect(html('**negrito** *itálico* _também_ ~~riscado~~ `a*b*c`')).toBe(
      '<strong>negrito</strong> <em>itálico</em> <em>também</em> <s>riscado</s> <code class="md-code">a*b*c</code>',
    );
  });

  it('nests emphasis', () => {
    expect(html('**muito *bom***')).toBe('<strong>muito <em>bom</em></strong>');
  });

  it('keeps snake_case and lone markers as text', () => {
    expect(html('nome_de_variavel e 2 * 3 * 4')).toBe('nome_de_variavel e 2 * 3 * 4');
  });

  it('keeps links atomic and trims sentence punctuation', () => {
    expect(html('vê https://x.com/a_b_c/*d*.')).toBe(
      'vê <a href="https://x.com/a_b_c/*d*" target="_blank" rel="noreferrer">https://x.com/a_b_c/*d*</a>.',
    );
  });

  it('renders mentions, also inside emphasis', () => {
    expect(html('**@joao_silva** viu?')).toBe(
      '<strong><b class="mention">@joao_silva</b></strong> viu?',
    );
    expect(html('fala @pedro.')).toBe('fala <b class="mention">@pedro</b>.');
  });

  it('keeps an unknown mention as text', () => {
    const out = renderToStaticMarkup(<>{renderMarkdown('oi @ninguem', () => null)}</>);
    expect(out).toBe('oi @ninguem');
  });

  it('renders spoilers', () => {
    expect(html('o final é ||ele morre||')).toContain('class="md-spoiler "');
  });

  it('renders code blocks literally, with or without a language', () => {
    expect(html('antes\n```ts\nconst a = **1**;\n```\ndepois')).toBe(
      'antes<pre class="md-codeblock" data-language="ts"><code>const a = **1**;</code></pre>depois',
    );
    expect(html('```\nsem linguagem\n```')).toBe(
      '<pre class="md-codeblock"><code>sem linguagem</code></pre>',
    );
  });

  it('groups consecutive quote lines', () => {
    expect(html('> linha 1\n> **linha 2**\nresposta')).toBe(
      '<blockquote class="md-quote">linha 1\n<strong>linha 2</strong></blockquote>resposta',
    );
  });
});

describe('hideSpoilers', () => {
  it('replaces spoilers for plain-text places', () => {
    expect(hideSpoilers('o final: ||ele morre|| e ||mais||')).toBe(
      'o final: (spoiler) e (spoiler)',
    );
  });
});
