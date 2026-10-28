import { describe, expect, it } from 'vitest';
import { badgeMentions, decideNotify } from './notify';

const base = {
  notifications: true,
  notifyAll: true,
  doNotDisturb: false,
  channelMode: undefined,
  mentionsMe: false,
  focused: false,
  viewing: false,
} as const;

describe('decideNotify', () => {
  it('follows the general setting without a channel choice', () => {
    expect(decideNotify(base).toast).toBe(true);
    expect(decideNotify({ ...base, notifyAll: false }).toast).toBe(false);
    expect(decideNotify({ ...base, focused: true }).toast).toBe(false);
  });

  it('lets a channel override the general setting', () => {
    expect(decideNotify({ ...base, notifyAll: false, channelMode: 'all' }).toast).toBe(true);
    expect(decideNotify({ ...base, channelMode: 'mentions' }).toast).toBe(false);
    expect(decideNotify({ ...base, channelMode: 'mentions', mentionsMe: true }).toast).toBe(true);
  });

  it('"Nada" silences even mentions, with no flash', () => {
    expect(decideNotify({ ...base, channelMode: 'none', mentionsMe: true })).toEqual({
      toast: false,
      flash: false,
    });
  });

  it('"Não perturbe" and the master switch silence everything', () => {
    expect(decideNotify({ ...base, doNotDisturb: true, mentionsMe: true })).toEqual({
      toast: false,
      flash: false,
    });
    expect(decideNotify({ ...base, notifications: false, mentionsMe: true }).toast).toBe(false);
  });

  it('flashes on a mention only while unfocused; no toast when looking at that channel', () => {
    expect(decideNotify({ ...base, mentionsMe: true })).toEqual({ toast: true, flash: true });
    expect(decideNotify({ ...base, mentionsMe: true, focused: true, viewing: true })).toEqual({
      toast: false,
      flash: false,
    });
    expect(decideNotify({ ...base, mentionsMe: true, focused: true, viewing: false }).toast).toBe(
      true,
    );
  });
});

describe('badgeMentions', () => {
  it('skips channels set to "Nada"', () => {
    expect(badgeMentions({ 1: 2, 2: 3, 3: 1 }, { '2': 'none', '3': 'mentions' })).toBe(3);
  });
});
