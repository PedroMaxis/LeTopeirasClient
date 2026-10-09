import type { KeyModifier } from '../shared/ipc';
import type { NativeAddon } from './native';

export const POLL_MS = 15;
const RECORD_TIMEOUT_MS = 10_000;

const VK_ESCAPE = 0x1b;
/**
 * Left/right click would fire when pressing "Gravar" itself; generic Shift/Ctrl/Alt duplicate
 * their left/right variants.
 */
const RECORD_IGNORED = new Set([0x01, 0x02, 0x10, 0x11, 0x12]);
/** Left/right Shift, Ctrl and Alt: modifiers of a combo, never its key. */
const MODIFIER_KEYS = new Set([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]);
const MOUSE_NAMES: Record<number, string> = {
  0x04: 'Botão do meio',
  0x05: 'Mouse 4',
  0x06: 'Mouse 5',
};

/** Generic virtual-key codes, true for either side. */
const MODIFIER_VK: Record<KeyModifier, number> = { ctrl: 0x11, shift: 0x10, alt: 0x12 };
const MODIFIER_NAMES: Record<KeyModifier, string> = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' };
const MODIFIERS = Object.keys(MODIFIER_VK) as KeyModifier[];

export function keyName(addon: NativeAddon, vk: number): string {
  const name = MOUSE_NAMES[vk] ?? addon.keyName(vk);
  return name && !name.startsWith('<') ? name : `Tecla ${vk}`;
}

export function heldModifiers(addon: NativeAddon): KeyModifier[] {
  return MODIFIERS.filter((mod) => addon.isKeyDown(MODIFIER_VK[mod]));
}

export function comboName(addon: NativeAddon, vk: number, mods: readonly KeyModifier[]): string {
  return [
    ...MODIFIERS.filter((m) => mods.includes(m)).map((m) => MODIFIER_NAMES[m]),
    keyName(addon, vk),
  ].join(' + ');
}

export interface RecordedKey {
  vk: number;
  mods: KeyModifier[];
}

interface Recording {
  timer: ReturnType<typeof setInterval>;
  finish(key: RecordedKey | null): void;
}

let recording: Recording | null = null;

export function cancelRecording(): void {
  recording?.finish(null);
}

/**
 * Waits for the next key or mouse button (left/right click excluded). With `combo`, Shift,
 * Ctrl and Alt only count as modifiers held with that key; without it they are keys of their
 * own (push-to-talk on Left Ctrl). Resolves null on Escape, after a timeout, or when another
 * recording starts.
 */
export function recordKey(addon: NativeAddon, combo: boolean): Promise<RecordedKey | null> {
  cancelRecording();
  return new Promise((resolve) => {
    // Only a key that goes down after recording starts counts, not one already held.
    const held = new Set<number>();
    for (let vk = 1; vk <= 254; vk++) if (addon.isKeyDown(vk)) held.add(vk);
    const startedAt = Date.now();
    const current: Recording = {
      timer: setInterval(() => {
        if (Date.now() - startedAt > RECORD_TIMEOUT_MS) return current.finish(null);
        for (let vk = 1; vk <= 254; vk++) {
          if (!addon.isKeyDown(vk)) {
            held.delete(vk);
            continue;
          }
          if (held.has(vk) || RECORD_IGNORED.has(vk)) continue;
          if (combo && MODIFIER_KEYS.has(vk)) continue;
          if (vk === VK_ESCAPE) return current.finish(null);
          return current.finish({ vk, mods: combo ? heldModifiers(addon) : [] });
        }
      }, POLL_MS),
      finish(key: RecordedKey | null) {
        clearInterval(current.timer);
        if (recording === current) recording = null;
        resolve(key);
      },
    };
    recording = current;
  });
}
