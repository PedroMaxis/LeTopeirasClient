/** `/files/<sha256>.webp` on our server; nothing else may be downloaded by `image:save`. */
const FILE_PATH = /^\/files\/([0-9a-f]{64})\.webp$/;

/** The content hash of a chat image URL on `serverUrl`'s origin, or null for any other URL. */
export function imageHashFromUrl(rawUrl: unknown, serverUrl: string): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.length > 300) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(serverUrl).origin || url.search || url.hash || url.username)
    return null;
  return FILE_PATH.exec(url.pathname)?.[1] ?? null;
}

/** `letopeiras-<first 8 of the hash>.webp` */
export const imageFileName = (hash: string) => `letopeiras-${hash.slice(0, 8)}.webp`;
