import { describe, expect, it } from 'vitest';
import { imageFileName, imageHashFromUrl } from './image-url';

const SERVER = 'https://letopeiras.duckdns.org';
const HASH = 'a'.repeat(63) + 'b';

describe('imageHashFromUrl', () => {
  it('accepts a file on the server', () => {
    expect(imageHashFromUrl(`${SERVER}/files/${HASH}.webp`, SERVER)).toBe(HASH);
    expect(
      imageHashFromUrl(`http://127.0.0.1:3000/files/${HASH}.webp`, 'http://127.0.0.1:3000'),
    ).toBe(HASH);
  });

  it('rejects other hosts, ports and schemes', () => {
    expect(imageHashFromUrl(`https://evil.example/files/${HASH}.webp`, SERVER)).toBeNull();
    expect(
      imageHashFromUrl(`https://letopeiras.duckdns.org:8443/files/${HASH}.webp`, SERVER),
    ).toBeNull();
    expect(imageHashFromUrl(`http://letopeiras.duckdns.org/files/${HASH}.webp`, SERVER)).toBeNull();
    expect(
      imageHashFromUrl(`https://letopeiras.duckdns.org@evil.example/files/${HASH}.webp`, SERVER),
    ).toBeNull();
  });

  it('rejects other paths and extras', () => {
    expect(imageHashFromUrl(`${SERVER}/users/me`, SERVER)).toBeNull();
    expect(imageHashFromUrl(`${SERVER}/files/${HASH}.png`, SERVER)).toBeNull();
    expect(imageHashFromUrl(`${SERVER}/files/${HASH.slice(1)}.webp`, SERVER)).toBeNull();
    expect(imageHashFromUrl(`${SERVER}/files/../files/${HASH}.webp?x=1`, SERVER)).toBeNull();
    expect(imageHashFromUrl(`${SERVER}/files/${HASH}.webp#x`, SERVER)).toBeNull();
  });

  it('rejects things that are not URLs', () => {
    expect(imageHashFromUrl(42, SERVER)).toBeNull();
    expect(imageHashFromUrl('nada', SERVER)).toBeNull();
    expect(imageHashFromUrl(undefined, SERVER)).toBeNull();
  });
});

describe('imageFileName', () => {
  it('uses the first 8 characters', () => {
    expect(imageFileName(HASH)).toBe('letopeiras-aaaaaaaa.webp');
  });
});
