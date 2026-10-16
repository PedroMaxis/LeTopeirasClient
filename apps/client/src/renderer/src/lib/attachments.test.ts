import { describe, expect, it } from 'vitest';
import { pickImages } from './attachments';

const file = (name: string, type: string, size: number) =>
  new File([new Uint8Array(size)], name, { type });

describe('pickImages', () => {
  it('keeps images up to the 4-per-message limit', () => {
    const files = Array.from({ length: 6 }, (_, i) => file(`${i}.png`, 'image/png', 10));
    const { accepted, errors } = pickImages(files, 1);
    expect(accepted).toHaveLength(3);
    expect(errors).toEqual(['Dá para mandar até 4 imagens por mensagem.']);
  });

  it('refuses other types and files over 10 MB', () => {
    const { accepted, errors } = pickImages(
      [file('a.pdf', 'application/pdf', 10), file('b.png', 'image/png', 10 * 1024 * 1024 + 1)],
      0,
    );
    expect(accepted).toEqual([]);
    expect(errors).toEqual([
      'a.pdf não é uma imagem (PNG, JPEG, WebP ou GIF).',
      'b.png tem mais de 10 MB.',
    ]);
  });
});
