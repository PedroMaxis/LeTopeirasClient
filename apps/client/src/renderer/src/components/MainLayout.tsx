import { useEffect, useMemo, useState } from 'react';
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

/** Last text channel on screen, per user (the PC may have more than one account). */
const lastTextKey = (userId: number) => `letopeiras.lastTextChannel.${userId}`;

function loadLastText(userId: number): number | null {
  try {
    const id = Number(localStorage.getItem(lastTextKey(userId)));
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

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
  const [lastText, setLastText] = useState<number | null>(null);
  const meId = me?.id;
  const storedLastText = useMemo(() => (meId ? loadLastText(meId) : null), [meId]);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // When nothing (or a deleted or now-locked channel) is selected, or we left the voice
  // channel on screen, fall back to the last text channel (this session's, then the stored
  // one) and then to the first text channel we can open.
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
  const canOpenText = (id: number | null): id is number =>
    id !== null && channels.some((c) => c.id === id && c.type === 'text' && canAccess(me, c));
  const fallbackId = [lastText, storedLastText].find(canOpenText) ?? firstText?.id;
  const view: View | null =
    selected &&
    selectedExists &&
    (selected.kind === 'text' || voiceChannelId === selected.channelId)
      ? selected
      : fallbackId !== undefined
        ? { kind: 'text', channelId: fallbackId }
        : null;

  // Tells the chat which channel is on screen (mentions there don't notify).
  const viewingTextChannel = view?.kind === 'text' ? view.channelId : null;
  useEffect(() => {
    chat.setViewingChannel(viewingTextChannel);
  }, [chat, viewingTextChannel]);

  // Reopen there next time.
  useEffect(() => {
    if (!meId || viewingTextChannel === null) return;
    try {
      localStorage.setItem(lastTextKey(meId), String(viewingTextChannel));
    } catch {
      // Not worth bothering anyone about; next start just opens the first channel.
    }
  }, [meId, viewingTextChannel]);

  // Clicking a message notification opens its channel.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const channelId = (event as CustomEvent<number>).detail;
      setSettingsPage(null);
      setSelected({ kind: 'text', channelId });
      setLastText(channelId);
    };
    window.addEventListener(OPEN_CHANNEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHANNEL_EVENT, onOpen);
  }, []);

  const actions: LayoutActions = {
    openView: (next) => {
      setSelected(next);
      if (next.kind === 'text') setLastText(next.channelId);
    },
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
  const voiceChannel =
    voiceChannelId !== null ? channels.find((c) => c.id === voiceChannelId) : undefined;

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
        {voiceChannel && (
          <VoiceStage channel={voiceChannel} actions={actions} hidden={view?.kind !== 'voice'} />
        )}
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
