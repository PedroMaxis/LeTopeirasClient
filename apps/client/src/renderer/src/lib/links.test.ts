import { describe, expect, it } from 'vitest';
import { hostOf, linkText, parseHttpUrl } from './links';

describe('parseHttpUrl', () => {
  it('accepts only http(s) with a host', () => {
    expect(parseHttpUrl('https://a.com/x')?.hostname).toBe('a.com');
    expect(parseHttpUrl('http://a.com')?.hostname).toBe('a.com');
    expect(parseHttpUrl('javascript:alert(1)')).toBeNull();
    expect(parseHttpUrl('file:///c:/x')).toBeNull();
    expect(parseHttpUrl('nada')).toBeNull();
  });
});

describe('hostOf', () => {
  it('ignores case, www and paths', () => {
    expect(hostOf('https://WWW.Exemplo.com/a?b')).toBe('exemplo.com');
    expect(hostOf('exemplo.com/a')).toBe('exemplo.com');
  });
});

describe('linkText', () => {
  it('keeps ordinary names', () => {
    expect(linkText('clique aqui', 'https://a.com')).toBe('clique aqui');
    expect(linkText('Site do jogo v1.2', 'https://a.com')).toBe('Site do jogo v1.2');
  });

  it('keeps an address that matches its destination', () => {
    expect(linkText('a.com', 'https://www.a.com/x')).toBe('a.com');
    expect(linkText('https://a.com/x', 'https://a.com/y')).toBe('https://a.com/x');
  });

  it('shows the destination when the text is another address', () => {
    expect(linkText('paypal.com', 'https://evil.example/login')).toBe('https://evil.example/login');
    expect(linkText('https://banco.com.br', 'https://x.io')).toBe('https://x.io');
  });
});
