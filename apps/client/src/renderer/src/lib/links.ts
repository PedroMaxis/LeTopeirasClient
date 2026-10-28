// Named links ([text](https://…)): what to show, and which domains skip the confirmation.

/** A valid http(s) URL with a host, or null. */
export function parseHttpUrl(text: string): URL | null {
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url : null;
  } catch {
    return null;
  }
}

/** Lowercase host without "www.", from a URL or a bare "dominio.com/caminho". */
export function hostOf(address: string): string | null {
  const url = parseHttpUrl(/^https?:\/\//i.test(address) ? address : `https://${address}`);
  return url ? url.hostname.toLowerCase().replace(/^www\./, '') : null;
}

const ADDRESS_LIKE = /^(?:https?:\/\/)?(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?::\d+)?(?:[/?#]\S*)?$/u;

/**
 * What the link shows. A text that looks like an address but points somewhere else (a phishing
 * trick) is replaced by the real destination.
 */
export function linkText(label: string, href: string): string {
  const trimmed = label.trim();
  if (!ADDRESS_LIKE.test(trimmed)) return label;
  return hostOf(trimmed) === hostOf(href) ? label : href;
}

/* ------------------------------------------------- domains that skip the dialog */

const TRUSTED_KEY = 'letopeiras.trustedLinkDomains';

function readTrusted(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TRUSTED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

export function isTrustedDomain(host: string): boolean {
  return readTrusted().includes(host);
}

export function trustDomain(host: string): void {
  try {
    const next = [...new Set([...readTrusted(), host])].slice(-500);
    localStorage.setItem(TRUSTED_KEY, JSON.stringify(next));
  } catch {
    // It will just ask again.
  }
}
