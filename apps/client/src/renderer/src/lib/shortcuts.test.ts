import { describe, expect, it } from 'vitest';
import { shortcutGroups } from './shortcuts';

const none = { muteKey: null, deafenKey: null, pttKey: null };

describe('shortcutGroups', () => {
  const voice = (s: Parameters<typeof shortcutGroups>[0]) =>
    shortcutGroups(s).find((g) => g.title === 'Voz')?.items ?? [];

  it('marks unset voice keys as null', () => {
    expect(voice(none).map((i) => i.keys)).toEqual([null, null, null]);
  });

  it('shows the keys people chose', () => {
    const items = voice({
      muteKey: { vk: 77, mods: ['ctrl', 'shift'], name: 'Ctrl + Shift + M' },
      deafenKey: null,
      pttKey: { vk: 20, name: 'Caps Lock' },
    });
    expect(items.map((i) => i.keys)).toEqual(['Ctrl + Shift + M', null, 'Caps Lock']);
  });

  it('has no empty labels', () => {
    for (const group of shortcutGroups(none)) {
      for (const item of group.items) expect(item.label).not.toBe('');
    }
  });
});
