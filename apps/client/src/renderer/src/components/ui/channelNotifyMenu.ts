import type { ChannelNotify } from '../../lib/notify';
import { settings, updateSettings } from '../../lib/settings';
import type { MenuEntries } from './ContextMenu';

const MODES: { mode: ChannelNotify; label: string }[] = [
  { mode: 'all', label: 'Todas as mensagens' },
  { mode: 'mentions', label: 'Só menções' },
  { mode: 'none', label: 'Nada' },
];

/** The "Notificações" block of a channel's menu (sidebar and header bell). */
export function channelNotifyEntries(channelId: number): MenuEntries {
  const { channelNotify, notifyAll } = settings.get();
  const current = channelNotify[channelId];
  const set = (mode: ChannelNotify | undefined) => {
    const { [channelId]: _old, ...rest } = settings.get().channelNotify;
    updateSettings({ channelNotify: mode ? { ...rest, [channelId]: mode } : rest });
  };
  const check = (on: boolean) => (on ? '✓' : undefined);
  return [
    { title: 'Notificações' },
    {
      label: `Padrão (${notifyAll ? 'todas as mensagens' : 'só menções'})`,
      hint: check(current === undefined),
      onSelect: () => set(undefined),
    },
    ...MODES.map(({ mode, label }) => ({
      label,
      hint: check(current === mode),
      onSelect: () => set(mode),
    })),
  ];
}
