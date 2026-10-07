import { useEffect, useState } from 'react';
import { OPEN_CHANNEL_EVENT } from '../lib/notify';
import { canAccess } from '../lib/roles';
import { settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { useSession } from '../state/session';
import { ChannelSidebar } from './sidebar/ChannelSidebar';
import { ChatView } from './chat/ChatView';
import { MemberList } from './MemberList';
import { ScreenPicker } from './ScreenPicker';
import { SettingsModal, type SettingsPage } from './settings/SettingsModal';
import { Logo } from './ui/Logo';
import { VoiceStage } from './voice/VoiceStage';

export type View = { kind: 'text' | 'voice'; channelId: number };

export interface LayoutActions {
  openView(view: View): void;
  /** Opens the settings, optionally on a given page. */
  openSettings(page?: SettingsPage): void;
  openScreenPicker(): void;
}

export function MainLayout() {
  const { chat, voice } = useSession();
  const status = useStore(chat.store, (s) => s.status);
  const me = useStore(chat.store, (s) => s.me);
  const channels = useStore(chat.store, (s) => s.channels);
  const categories = useStore(chat.store, (s) => s.categories);
  const voiceChannelId = useStore(voice.store, (s) => s.channelId);
  const showMembers = useStore(settings, (s) => s.showMembers);

  const [selected, setSelected] = useState<View | null>(null);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Fall back to the first text channel we can open when nothing (or a deleted or
  // now-locked channel) is selected, and leave the voice view once we're out of it.
  const categoryOrder = (categoryId: number | null) =>
    categoryId === null ? -1 : (categories.find((c) => c.id === categoryId)?.position ?? 0);
  const firstText = channels
    .filter((c) => c.type === 'text' && canAccess(me, c))
    .sort(
      (a, b) =>
        categoryOrder(a.categoryId) - categoryOrder(b.categoryId) || a.position - b.position,
    )[0];
  const selectedExists =
    selected && channels.some((c) => c.id === selected.channelId && canAccess(me, c));
  const view: View | null =
    selected &&
    selectedExists &&
    (selected.kind === 'text' || voiceChannelId === selected.channelId)
      ? selected
      : firstText
        ? { kind: 'text', channelId: firstText.id }
        : null;

  // Tells the chat which channel is on screen (mentions there don't notify).
  const viewingTextChannel = view?.kind === 'text' ? view.channelId : null;
  useEffect(() => {
    chat.setViewingChannel(viewingTextChannel);
  }, [chat, viewingTextChannel]);

  // Clicking a message notification opens its channel.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const channelId = (event as CustomEvent<number>).detail;
      setSettingsPage(null);
      setSelected({ kind: 'text', channelId });
    };
    window.addEventListener(OPEN_CHANNEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHANNEL_EVENT, onOpen);
  }, []);

  const actions: LayoutActions = {
    openView: setSelected,
    openSettings: (page = 'voice') => setSettingsPage(page),
    openScreenPicker: () => setPickerOpen(true),
  };

  if (!me) {
    return (
      <div className="splash">
        <Logo size={96} />
        <p>
          {status === 'reconnecting'
            ? 'Servidor fora do ar, tentando de novo…'
            : 'Cavucando, Cavucando…'}
        </p>
      </div>
    );
  }

  const channel = view && channels.find((c) => c.id === view.channelId);

  return (
    <div className="main-layout">
      <ChannelSidebar view={view} actions={actions} />
      <main className="main-area">
        {status !== 'ready' && (
          <div className="connection-banner">Conexão perdida. Reconectando…</div>
        )}
        {channel && view?.kind === 'text' && (
          <div className="chat-with-members">
            <ChatView channel={channel} />
            {showMembers && <MemberList />}
          </div>
        )}
        {channel && view?.kind === 'voice' && <VoiceStage channel={channel} actions={actions} />}
        {!channel && (
          <div className="empty-state">
            <Logo size={72} />
            <p>Nenhum canal ainda. O admin pode criar um nas configurações.</p>
          </div>
        )}
      </main>
      {settingsPage && (
        <SettingsModal initialPage={settingsPage} onClose={() => setSettingsPage(null)} />
      )}
      {pickerOpen && <ScreenPicker onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
