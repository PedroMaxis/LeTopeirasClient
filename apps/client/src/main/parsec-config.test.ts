import { describe, expect, it } from 'vitest';
import { readEchoTarget, withEchoTarget } from './parsec-config';

const COMMENT = 'See https://parsec.app/config for documentation and example.';

const config = (settings: Record<string, unknown>) =>
  JSON.stringify([COMMENT, settings], null, '\t');

describe('readEchoTarget', () => {
  it('is off without "New" echo cancelling', () => {
    expect(readEchoTarget(config({ host_name: { value: 'PC' } }))).toBe('off');
    expect(
      readEchoTarget(
        config({ host_audio_cancel: { value: 1 }, echo_app_selection: { value: 'discord.exe' } }),
      ),
    ).toBe('off');
  });

  it('recognizes our executable and Discord, ignoring case', () => {
    const on = (exe: string) =>
      readEchoTarget(
        config({ host_audio_cancel: { value: 2 }, echo_app_selection: { value: exe } }),
      );
    expect(on('LeTopeiras Client.exe')).toBe('letopeiras');
    expect(on('letopeiras client.exe')).toBe('letopeiras');
    expect(on('Discord.exe')).toBe('discord');
    expect(on('zoom.exe')).toBe('other');
    expect(on('none')).toBe('off');
  });

  it('throws on invalid JSON', () => {
    expect(() => readEchoTarget('[oops')).toThrow();
  });
});

describe('withEchoTarget', () => {
  it('sets New + the executable and keeps the other settings and the comment', () => {
    const before = config({ host_name: { value: 'PC' }, host_audio_cancel: { value: 0 } });
    const after = JSON.parse(withEchoTarget(before, 'letopeiras')) as unknown[];
    expect(after[0]).toBe(COMMENT);
    expect(after[1]).toEqual({
      host_name: { value: 'PC' },
      host_audio_cancel: { value: 2 },
      echo_app_selection: { value: 'LeTopeiras Client.exe' },
    });
  });

  it('switches back to Discord', () => {
    const ours = withEchoTarget(config({}), 'letopeiras');
    expect(readEchoTarget(withEchoTarget(ours, 'discord'))).toBe('discord');
  });

  it('adds the settings object when the file only has the comment', () => {
    const after = withEchoTarget(JSON.stringify([COMMENT]), 'discord');
    expect(readEchoTarget(after)).toBe('discord');
  });

  it('refuses a file that is not Parsec’s format', () => {
    expect(() => withEchoTarget('{"a":1}', 'discord')).toThrow();
    expect(() => withEchoTarget('not json', 'discord')).toThrow();
  });
});
