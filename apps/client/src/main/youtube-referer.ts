import type { Session } from 'electron';

const PRODUCTION_REFERER = 'https://letopeiras.duckdns.org/';

/**
 * The Referer to give YouTube. The page loads from `file://`, which sends none, and the embed
 * answers error 153 ("player configuration error") to that. It must look like a website, so
 * an `https` server URL is used as it is and anything else (local dev) falls back to ours.
 */
export function embedReferer(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    if (url.protocol === 'https:') return `${url.origin}/`;
  } catch {
    // Falls through to the default.
  }
  return PRODUCTION_REFERER;
}

/** Adds that Referer to requests for the music player, and to nothing else. */
export function registerYouTubeReferer(ses: Session, serverUrl: string): void {
  const referer = embedReferer(serverUrl);
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*'] },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, Referer: referer } });
    },
  );
}
