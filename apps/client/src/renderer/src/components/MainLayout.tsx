import { useEffect, useMemo, useState } from 'react';
import type { Channel } from '@letopeiras/shared';
import { isUnread, sidebarOrder } from '../lib/channels';
import { OPEN_CHANNEL_EVENT } from '../lib/notify';
import { canAccess } from '../lib/roles';
import { settings, updateSettings } from '../lib/settings';
import { useStore } from '../lib/store';
import { showToast } from '../lib/toast';
import { useSession } from '../state/session';
import { ChannelSidebar } from './sidebar/ChannelSidebar';
import { ChatView } from './chat/ChatView';
import { jumpToMessage } from './chat/events';
import { SearchPanel, type SearchRequest } from './chat/SearchPanel';
import { MemberList } from './MemberList';
import { MusicPlayer } from './music/MusicPlayer';
import { QuickSwitcher } from './QuickSwitcher';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ScreenPicker } from './ScreenPicker';
import { SettingsModal, type SettingsPage } from './settings/SettingsModal';
import { Mole } from './ui/Mole';
import { VoiceStage } from './voice/VoiceStage';
import { WhatsNew } from './WhatsNew';

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
  /** Opens a channel like clicking it in the sidebar: joins a voice channel, refuses a locked one. */
  openChannel(channel: Channel): void;
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
  const voiceChatOpen = useStore(settings, (s) => s.voiceChat);

  const [selected, setSelected] = useState<View | null>(null);
  const [lastText, setLastText] = useState<number | null>(null);
  const [voiceChatId, setVoiceChatId] = useState<number | null>(null);
  const meId = me?.id;
  const storedLastText = useMemo(() => (meId ? loadLastText(meId) : null), [meId]);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [search, setSearch] = useState<SearchRequest | null>(null);
  // Focus mode: only on the voice stage, only in memory.
  const [focusMode, setFocusMode] = useState(false);

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

  // Leaving the stage (to a text channel, or out of the room) ends focus mode.
  if (focusMode && view?.kind !== 'voice') setFocusMode(false);

  // The voice stage's chat panel: the channel picked there, else the last text channel.
  const voiceChatChannelId = canOpenText(voiceChatId) ? voiceChatId : (fallbackId ?? null);
  const voiceChatShown = view?.kind === 'voice' && voiceChatOpen && voiceChatChannelId !== null;

  // Tells the chat which channel is on screen (mentions there don't notify).
  const viewingTextChannel =
    view?.kind === 'text' ? view.channelId : voiceChatShown ? voiceChatChannelId : null;
  useEffect(() => {
    chat.setViewingChannel(viewingTextChannel);
  }, [chat, viewingTextChannel]);

  // Reopen there next time (only channels opened from the sidebar).
  const lastShownText = view?.kind === 'text' ? view.channelId : null;
  useEffect(() => {
    if (!meId || lastShownText === null) return;
    try {
      localStorage.setItem(lastTextKey(meId), String(lastShownText));
    } catch {
      // Not worth bothering anyone about; next start just opens the first channel.
    }
  }, [meId, lastShownText]);

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

  const openView = (next: View) => {
    setSelected(next);
    if (next.kind === 'text') setLastText(next.channelId);
  };
  const openChannel = (target: Channel) => {
    if (!canAccess(me, target)) {
      showToast('Esse canal é privado. Peça a tag para o admin.', 'info');
      return;
    }
    if (target.type === 'voice' && voiceChannelId !== target.id) void voice.join(target.id);
    openView({ kind: target.type, channelId: target.id });
  };

  // Ctrl+= / Ctrl+- / Ctrl+0 are handled in main; it tells us the new zoom.
  useEffect(
    () =>
      window.api.onZoomChanged((factor) =>
        showToast(`Zoom: ${Math.round(factor * 100)} %`, 'info'),
      ),
    [],
  );

  // "Não perturbe": the tray menu toggles it and shows its checkmark.
  const doNotDisturb = useStore(settings, (s) => s.doNotDisturb);
  useEffect(() => {
    void window.api.setTrayDoNotDisturb(doNotDisturb);
  }, [doNotDisturb]);
  useEffect(
    () =>
      window.api.onToggleDoNotDisturb(() =>
        updateSettings({ doNotDisturb: !settings.get().doNotDisturb }),
      ),
    [],
  );

  // Ctrl+K: quick switcher. Alt+↑/↓: previous/next text channel in the sidebar, and with Shift
  // the previous/next unread one.
  const currentText = view?.kind === 'text' ? view.channelId : (fallbackId ?? null);
  const onStage = view?.kind === 'voice';
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
        e.preventDefault();
        setSwitcherOpen((open) => !open);
        return;
      }
      // Ctrl+Shift+F: focus mode on the voice stage (`code`: the letter, not the layout).
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyF') {
        e.preventDefault();
        if (onStage) setFocusMode((on) => !on);
        return;
      }
      // Ctrl+/: the shortcuts window (it closes itself on the same keys). `key`, not `code`:
      // on ABNT2 keyboards "/" is not where it is on US ones.
      if (e.ctrlKey && !e.altKey && e.key === '/') {
        e.preventDefault();
        if (!shortcutsOpen && !document.querySelector('[role="dialog"]')) setShortcutsOpen(true);
        return;
      }
      // Shift+Esc: mark every channel as read, unless a dialog or menu is open.
      if (e.key === 'Escape' && e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (
          settingsPage ||
          pickerOpen ||
          switcherOpen ||
          document.querySelector('[role="dialog"]')
        ) {
          return;
        }
        e.preventDefault();
        chat.markAllRead();
        showToast('Tudo marcado como lido', 'info');
        return;
      }
      if (!e.altKey || e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      if (settingsPage || pickerOpen) return;
      e.preventDefault();
      const s = chat.store.get();
      const texts = sidebarOrder(s.channels, s.categories).filter(
        (c) => c.type === 'text' && canAccess(s.me, c),
      );
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const at = texts.findIndex((c) => c.id === currentText);
      let target: Channel | undefined;
      for (let i = 1; i <= texts.length && !target; i++) {
        const candidate = texts[(((at + step * i) % texts.length) + texts.length) % texts.length];
        if (!candidate || candidate.id === currentText) continue;
        const silenced = settings.get().channelNotify[candidate.id] === 'none';
        if (!e.shiftKey || (isUnread(candidate, s.readStates) && !silenced)) target = candidate;
      }
      if (target) {
        setSelected({ kind: 'text', channelId: target.id });
        setLastText(target.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chat, currentText, onStage, settingsPage, pickerOpen, switcherOpen, shortcutsOpen]);

  const actions: LayoutActions = {
    openView,
    openChannel,
    openSettings: (page = 'voice') => setSettingsPage(page),
    openScreenPicker: () => setPickerOpen(true),
  };

  if (!me) {
    return (
      <div className="splash">
        <Mole size={96} mode="dig" />
        <p>
          {status === 'reconnecting'
            ? 'Servidor fora do ar, tentando de novo…'
            : 'Cavucando, Cavucando…'}
        </p>
      </div>
    );
  }

  const channel = view && channels.find((c) => c.id === view.channelId);
  const voiceChatChannel =
    voiceChatChannelId !== null ? channels.find((c) => c.id === voiceChatChannelId) : undefined;
  const voiceChannel =
    voiceChannelId !== null ? channels.find((c) => c.id === voiceChannelId) : undefined;

  return (
    <div className={`main-layout ${focusMode ? 'focus' : ''}`}>
      <ChannelSidebar view={view} actions={actions} />
      <main className="main-area">
        {status !== 'ready' && (
          <div className="connection-banner">Conexão perdida. Reconectando…</div>
        )}
        {channel && view?.kind === 'text' && (
          <div className="chat-with-members">
            <ChatView
              channel={channel}
              onSearch={(query) => setSearch({ query, channelId: search?.channelId ?? null })}
            />
            {search ? (
              <SearchPanel
                request={search}
                channelId={channel.id}
                onScope={(channelId) => setSearch({ ...search, channelId })}
                onOpen={(message) => {
                  openView({ kind: 'text', channelId: message.channelId });
                  jumpToMessage({ channelId: message.channelId, messageId: message.id });
                }}
                onClose={() => setSearch(null)}
              />
            ) : (
              showMembers && <MemberList />
            )}
          </div>
        )}
        {voiceChannel && (
          <VoiceStage
            channel={voiceChannel}
            actions={actions}
            hidden={view?.kind !== 'voice'}
            focusMode={focusMode}
            onToggleFocus={() => setFocusMode((on) => !on)}
            chat={{
              channel: voiceChatChannel,
              open: voiceChatOpen,
              onToggle: () => updateSettings({ voiceChat: !voiceChatOpen }),
              onSelect: setVoiceChatId,
            }}
          />
        )}
        {!channel && (
          <div className="empty-state">
            <Mole size={72} />
            <p>Nenhum canal ainda. O admin pode criar um nas configurações.</p>
          </div>
        )}
      </main>
      {settingsPage && (
        <SettingsModal initialPage={settingsPage} onClose={() => setSettingsPage(null)} />
      )}
      {shortcutsOpen && (
        <ShortcutsDialog
          onClose={() => setShortcutsOpen(false)}
          onOpenVoiceSettings={() => setSettingsPage('voice')}
        />
      )}
      {pickerOpen && <ScreenPicker onClose={() => setPickerOpen(false)} />}
      <MusicPlayer />
      <WhatsNew />
      {switcherOpen && (
        <QuickSwitcher
          onOpen={(target) => {
            setSwitcherOpen(false);
            openChannel(target);
          }}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
    </div>
  );
}
