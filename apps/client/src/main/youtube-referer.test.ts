import { describe, expect, it } from 'vitest';
import { embedReferer } from './youtube-referer';

describe('embedReferer', () => {
  it('uses the server origin when it is https', () => {
    expect(embedReferer('https://letopeiras.duckdns.org')).toBe('https://letopeiras.duckdns.org/');
    expect(embedReferer('https://example.com:8443/api')).toBe('https://example.com:8443/');
  });

  it('falls back to the production address for local servers and junk', () => {
    expect(embedReferer('http://127.0.0.1:3000')).toBe('https://letopeiras.duckdns.org/');
    expect(embedReferer('not a url')).toBe('https://letopeiras.duckdns.org/');
  });
});
