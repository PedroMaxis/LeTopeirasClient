import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hideSpoilers, plainText, renderMarkdown } from './markdown';

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
    const copy = '<button type="button" class="md-copy">Copiar</button>';
    expect(html('antes\n```ts\nconst a = **1**;\n```\ndepois')).toBe(
      `antes<pre class="md-codeblock" data-language="ts">${copy}<code>const a = **1**;</code></pre>depois`,
    );
    expect(html('```\nsem linguagem\n```')).toBe(
      `<pre class="md-codeblock">${copy}<code>sem linguagem</code></pre>`,
    );
  });

  it('knows c++ and c# as languages', () => {
    expect(html('```c++\nint a;\n```')).toContain('data-language="c++"');
    expect(html('```c#\nint a;\n```')).toContain('data-language="c#"');
  });

  it('groups consecutive quote lines', () => {
    expect(html('> linha 1\n> **linha 2**\nresposta')).toBe(
      '<blockquote class="md-quote">linha 1\n<strong>linha 2</strong></blockquote>resposta',
    );
  });

  it('renders headings and small text, and keeps a lone # as text', () => {
    expect(html('# Grande\n## Médio\n### Pequeno\n-# miudinho')).toBe(
      '<div class="md-h1">Grande</div><div class="md-h2">Médio</div><div class="md-h3">Pequeno</div><div class="md-small">miudinho</div>',
    );
    expect(html('#1 do ranking, #sem espaço')).toBe('#1 do ranking, #sem espaço');
    expect(html('#### quatro')).toBe('#### quatro');
  });

  it('keeps text before and after a heading on their own lines', () => {
    expect(html('antes\n# Título\ndepois')).toBe('antes<div class="md-h1">Título</div>depois');
  });

  it('renders bullet and numbered lists with one nested level', () => {
    expect(html('- um\n- dois\n  - dois.a\n* três')).toBe(
      '<ul class="md-list"><li>um</li><li>dois<ul class="md-list"><li>dois.a</li></ul></li><li>três</li></ul>',
    );
    expect(html('3. c\n4. d')).toBe('<ol class="md-list" start="3"><li>c</li><li>d</li></ol>');
  });

  it('starts a new list when the kind changes, and ignores marker-like text', () => {
    expect(html('- a\n1. b')).toBe(
      '<ul class="md-list"><li>a</li></ul><ol class="md-list" start="1"><li>b</li></ol>',
    );
    expect(html('-sem espaço e *itálico*')).toBe('-sem espaço e <em>itálico</em>');
  });

  it('applies inline markup inside blocks', () => {
    expect(html('## **forte**')).toBe('<div class="md-h2"><strong>forte</strong></div>');
    expect(html('- *item*')).toBe('<ul class="md-list"><li><em>item</em></li></ul>');
  });

  it('works inside quotes', () => {
    expect(html('> # Título\n> - a\n> - b')).toBe(
      '<blockquote class="md-quote"><div class="md-h1">Título</div><ul class="md-list"><li>a</li><li>b</li></ul></blockquote>',
    );
  });

  it('renders named links showing the text, with the real address as title', () => {
    expect(html('veja [o site](https://a.com/x?y=1) agora')).toBe(
      'veja <a href="https://a.com/x?y=1" title="https://a.com/x?y=1" target="_blank" rel="noreferrer">o site</a> agora',
    );
  });

  it('shows the destination when the link text is a different address', () => {
    const out = html('[paypal.com](https://evil.example/login)');
    expect(out).toContain('>https://evil.example/login</a>');
    expect(out).not.toContain('>paypal.com<');
  });

  it('only makes named links of http(s)', () => {
    expect(html('[x](javascript:alert(1))')).not.toContain('<a');
    expect(html('[x](file:///c:/a)')).not.toContain('<a');
  });
});

describe('plainText', () => {
  it('drops block markers and link syntax, and hides spoilers', () => {
    expect(plainText('# Título\n- item\n-# nota\n[nome](https://a.com) ||x||')).toBe(
      'Título\nitem\nnota\nnome (spoiler)',
    );
    expect(plainText('#1 e 2 * 3')).toBe('#1 e 2 * 3');
  });
});

describe('hideSpoilers', () => {
  it('replaces spoilers for plain-text places', () => {
    expect(hideSpoilers('o final: ||ele morre|| e ||mais||')).toBe(
      'o final: (spoiler) e (spoiler)',
    );
  });
});
