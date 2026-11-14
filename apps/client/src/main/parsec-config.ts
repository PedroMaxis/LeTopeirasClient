// Pure edits of Parsec's config.json: which app the host's echo cancelling leaves out of the
// stream sent to guests. The file is `["<comment>", { "<key>": { "value": ... }, ... }]`.
// Key names come from Parsec's own binary: `host_audio_cancel` (0 Off, 1 Old, 2 New) and
// `echo_app_selection` (an executable name; the settings UI only offers a fixed list, but
// "New" excludes whatever process has that name, and its children, from the captured audio).
import type { ParsecEchoTarget } from '../shared/ipc';

const ECHO_MODE_NEW = 2;

/** Executable names per target. Ours is the Windows build's (productName + .exe). */
export const PARSEC_ECHO_EXES = {
  letopeiras: 'LeTopeiras Client.exe',
  discord: 'discord.exe',
} as const;

type Settings = Record<string, unknown>;

function settingsObject(doc: unknown): Settings | null {
  if (!Array.isArray(doc)) return null;
  const found = doc.find(
    (item) => typeof item === 'object' && item !== null && !Array.isArray(item),
  );
  return (found as Settings | undefined) ?? null;
}

function valueOf(settings: Settings, key: string): unknown {
  const entry = settings[key];
  return typeof entry === 'object' && entry !== null
    ? (entry as { value?: unknown }).value
    : undefined;
}

/** Which app Parsec currently leaves out of the guests' audio. Throws on invalid JSON. */
export function readEchoTarget(text: string): ParsecEchoTarget {
  const settings = settingsObject(JSON.parse(text));
  if (!settings || valueOf(settings, 'host_audio_cancel') !== ECHO_MODE_NEW) return 'off';
  const exe = valueOf(settings, 'echo_app_selection');
  if (typeof exe !== 'string') return 'off';
  const name = exe.toLowerCase();
  if (name === PARSEC_ECHO_EXES.letopeiras.toLowerCase()) return 'letopeiras';
  if (name === PARSEC_ECHO_EXES.discord) return 'discord';
  return name === 'none' || name === '' ? 'off' : 'other';
}

/**
 * The config with echo cancelling on "New" and `target`'s executable selected; every other
 * setting is kept. Throws when the text isn't Parsec's format, so a broken file is never
 * rewritten (Parsec erases a config it can't parse).
 */
export function withEchoTarget(text: string, target: keyof typeof PARSEC_ECHO_EXES): string {
  const doc: unknown = JSON.parse(text);
  if (!Array.isArray(doc)) throw new Error('Unexpected Parsec config format');
  let settings = settingsObject(doc);
  if (!settings) {
    settings = {};
    doc.push(settings);
  }
  settings['host_audio_cancel'] = { value: ECHO_MODE_NEW };
  settings['echo_app_selection'] = { value: PARSEC_ECHO_EXES[target] };
  return `${JSON.stringify(doc, null, '\t')}\n`;
}
