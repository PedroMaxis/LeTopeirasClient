import { LIMITS } from '@letopeiras/shared';
import { SERVER_URL } from './api';

const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Absolute URL of a file path the server gave us (`/files/<hash>.webp`). */
export const fileUrl = (path: string) => new URL(path, SERVER_URL).href;

/**
 * The files that can still go into a message that already has `current` images, plus PT-BR
 * messages for the ones left out. The server checks again; this just answers instantly.
 */
export function pickImages(files: File[], current: number): { accepted: File[]; errors: string[] } {
  const accepted: File[] = [];
  const errors: string[] = [];
  let full = false;
  for (const file of files) {
    if (!TYPES.has(file.type))
      errors.push(`${file.name} não é uma imagem (PNG, JPEG, WebP ou GIF).`);
    else if (file.size > LIMITS.attachmentMaxBytes) errors.push(`${file.name} tem mais de 10 MB.`);
    else if (current + accepted.length >= LIMITS.attachmentsPerMessage) full = true;
    else accepted.push(file);
  }
  if (full) errors.push(`Dá para mandar até ${LIMITS.attachmentsPerMessage} imagens por mensagem.`);
  return { accepted, errors };
}
