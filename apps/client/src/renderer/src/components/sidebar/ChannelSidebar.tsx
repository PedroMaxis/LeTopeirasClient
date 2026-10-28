import { useRef, useState, type MouseEvent } from 'react';
import type { Category, Channel, VoiceParticipant } from '@letopeiras/shared';
import { byTypeThenPosition } from '../../lib/channels';
import { canAccess, nameColor } from '../../lib/roles';
import { settings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import type { LayoutActions, View } from '../MainLayout';
import { Avatar } from '../ui/Avatar';
import { channelNotifyEntries } from '../ui/channelNotifyMenu';
import { useContextMenu } from '../ui/ContextMenu';
import { Icon } from '../ui/Icon';
import { Mole, type MoleHandle } from '../ui/Mole';
import { UserPanel } from './UserPanel';
import { VoicePanel } from './VoicePanel';
import { usePersonMenu } from '../PersonMenu';

interface Props {
  view: View | null;
  actions: LayoutActions;
}

const COLLAPSED_KEY = 'letopeiras.collapsedCategories';

function loadCollapsed(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as number[]);
  } catch {
    return new Set();
  }
}

export function ChannelSidebar({ view, actions }: Props) {
  const { chat } = useSession();
  const channels = useStore(chat.store, (s) => s.channels);
  const categories = useStore(chat.store, (s) => s.categories);
  const me = useStore(chat.store, (s) => s.me);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const mole = useRef<MoleHandle>(null);

  const toggle = (categoryId: number) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(categoryId)) next.add(categoryId);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const inCategory = (categoryId: number | null) =>
    channels.filter((c) => c.categoryId === categoryId).sort(byTypeThenPosition);
  const uncategorized = inCategory(null);

  return (
    <nav className="sidebar">
      <button type="button" className="sidebar-header" onClick={() => actions.openSettings()}>
        <span className="sidebar-brand">
          {/* Easter egg: the mole jumps instead of opening the settings. */}
          <span
            className="sidebar-mole"
            onClick={(e) => {
              e.stopPropagation();
              mole.current?.jump();
            }}
          >
            <Mole size={30} ref={mole} />
          </span>
          <span>LeTopeiras</span>
        </span>
        <Icon name="chevronDown" size={18} />
      </button>

      <div className="channel-list">
        {uncategorized.length > 0 && (
          <div className="category-spacer">
            {uncategorized.map((channel) => (
              <ChannelItem key={channel.id} channel={channel} view={view} actions={actions} />
            ))}
          </div>
        )}
        {categories.map((category) => (
          <CategorySection
            key={category.id}
            category={category}
            channels={inCategory(category.id)}
            collapsed={collapsed.has(category.id)}
            onToggle={() => toggle(category.id)}
            canManage={me?.isAdmin === true}
            view={view}
            actions={actions}
          />
        ))}
      </div>

      <VoicePanel actions={actions} />
      <UserPanel actions={actions} />
    </nav>
  );
}

function CategorySection(props: {
  category: Category;
  channels: Channel[];
  collapsed: boolean;
  onToggle(): void;
  canManage: boolean;
  view: View | null;
  actions: LayoutActions;
}) {
  const { chat, voice } = useSession();
  const readStates = useStore(chat.store, (s) => s.readStates);
  const inVoice = useStore(voice.store, (s) => s.channelId);
  const me = useStore(chat.store, (s) => s.me);
  const menu = useContextMenu();
  const { category, channels, collapsed, view } = props;

  const channelNotify = useStore(settings, (s) => s.channelNotify);
  const unreadHere = channels.filter(
    (c) =>
      c.type === 'text' &&
      canAccess(me, c) &&
      c.lastMessageId !== null &&
      c.lastMessageId > (readStates[c.id] ?? 0),
  );

  // A collapsed category still shows the open, unread and joined channels.
  const visible = collapsed
    ? channels.filter(
        (c) =>
          view?.channelId === c.id ||
          inVoice === c.id ||
          (channelNotify[c.id] !== 'none' &&
            c.lastMessageId !== null &&
            c.lastMessageId > (readStates[c.id] ?? 0)),
      )
    : channels;

  return (
    <div className="category">
      {menu.menu}
      <div
        className="category-header"
        onContextMenu={(event) =>
          menu.open(event, [
            {
              label: 'Marcar categoria como lida',
              disabled: unreadHere.length === 0,
              onSelect: () => unreadHere.forEach((c) => chat.markRead(c.id)),
            },
            {
              label: collapsed ? 'Expandir categoria' : 'Recolher categoria',
              onSelect: props.onToggle,
            },
          ])
        }
      >
        <button
          type="button"
          className={`section-header ${collapsed ? 'collapsed' : ''}`}
          onClick={props.onToggle}
          aria-expanded={!collapsed}
        >
          <Icon name="chevronDown" size={12} />
          <span className="category-name">{category.name.toUpperCase()}</span>
        </button>
        {props.canManage && (
          <button
            type="button"
            className="category-add"
            aria-label="Criar canal"
            title="Criar canal"
            onClick={() => props.actions.openSettings('channels')}
          >
            <Icon name="plus" size={16} />
          </button>
        )}
      </div>
      {visible.map((channel) => (
        <ChannelItem key={channel.id} channel={channel} view={view} actions={props.actions} />
      ))}
    </div>
  );
}

function ChannelItem({
  channel,
  view,
  actions,
}: {
  channel: Channel;
  view: View | null;
  actions: LayoutActions;
}) {
  const { chat, voice } = useSession();
  const me = useStore(chat.store, (s) => s.me);
  const readStates = useStore(chat.store, (s) => s.readStates);
  const mentions = useStore(chat.store, (s) => s.mentionCounts[channel.id] ?? 0);
  const participants = useStore(chat.store, (s) => s.voice[channel.id]);
  const inVoice = useStore(voice.store, (s) => s.channelId);
  const silenced = useStore(settings, (s) => s.channelNotify[channel.id] === 'none');

  const locked = !canAccess(me, channel);
  const kind = channel.type;
  const active = view?.kind === kind && view.channelId === channel.id;
  const unread =
    kind === 'text' &&
    !active &&
    !locked &&
    !silenced &&
    channel.lastMessageId !== null &&
    channel.lastMessageId > (readStates[channel.id] ?? 0);

  const open = () => actions.openChannel(channel);
  const menu = useContextMenu();
  const hasUnread =
    channel.lastMessageId !== null && channel.lastMessageId > (readStates[channel.id] ?? 0);
  const onContextMenu = (event: MouseEvent) =>
    menu.open(event, [
      kind === 'text' && {
        label: 'Marcar como lido',
        disabled: locked || !hasUnread,
        onSelect: () => chat.markRead(channel.id),
      },
      kind === 'text' && { separator: true },
      ...(kind === 'text' ? channelNotifyEntries(channel.id) : []),
      kind === 'voice' && {
        label: inVoice === channel.id ? 'Você está neste canal' : 'Entrar no canal',
        disabled: locked || inVoice === channel.id,
        onSelect: open,
      },
    ]);

  return (
    <div>
      {menu.menu}
      <button
        type="button"
        className={`channel-item ${active ? 'active' : ''} ${unread ? 'unread' : ''} ${locked ? 'locked' : ''} ${silenced ? 'silenced' : ''}`}
        onClick={open}
        onContextMenu={onContextMenu}
        title={
          locked
            ? 'Canal privado'
            : kind === 'voice'
              ? inVoice === channel.id
                ? 'Ver canal'
                : 'Entrar no canal'
              : undefined
        }
      >
        {(active || unread) && <span className="channel-pip" />}
        <Icon name={kind === 'text' ? 'hash' : 'speaker'} size={18} />
        <span className="channel-name">{channel.name}</span>
        {mentions > 0 && !active ? (
          <span
            className="mention-badge"
            title={`${mentions} ${mentions === 1 ? 'marcação' : 'marcações'}`}
          >
            {mentions > 99 ? '99+' : mentions}
          </span>
        ) : (
          channel.isPrivate && <Icon name="lock" size={14} className="channel-lock" />
        )}
      </button>
      {kind === 'voice' &&
        !locked &&
        participants?.map((p) => (
          <VoiceMember key={p.userId} channelId={channel.id} participant={p} />
        ))}
    </div>
  );
}

function VoiceMember({
  channelId,
  participant,
}: {
  channelId: number;
  participant: VoiceParticipant;
}) {
  const { chat, voice } = useSession();
  const user = useStore(chat.store, (s) => s.users[participant.userId]);
  const roles = useStore(chat.store, (s) => s.roles);
  const voiceStates = useStore(chat.store, (s) => s.voice[channelId]);
  // Speaking is only known for the room we're connected to.
  const speaking = useStore(
    voice.store,
    (s) => s.channelId === channelId && s.speaking.has(String(participant.userId)),
  );
  const personMenu = usePersonMenu();

  const watchers = (voiceStates ?? []).filter((v) =>
    v.watching.includes(participant.userId),
  ).length;
  const watchersTitle = watchers === 0 ? 'Ninguém assistindo' : `${watchers} assistindo`;

  return (
    <div
      className={`voice-member ${speaking ? 'speaking' : ''}`}
      onContextMenu={personMenu.open(participant.userId, { inVoice: true })}
    >
      {personMenu.menu}
      <Avatar user={user} size={22} speaking={speaking} />
      <span className="voice-member-name" style={{ color: nameColor(user, roles) }}>
        {user?.displayName ?? '…'}
      </span>
      <span className="voice-member-icons">
        {participant.screenSharing && (
          <span className="live-badge small" title={watchersTitle}>
            AO VIVO
          </span>
        )}
        {participant.camera && (
          <span title="Câmera ligada">
            <Icon name="video" size={14} />
          </span>
        )}
        {participant.deafened ? (
          <Icon name="headphonesOff" size={14} />
        ) : (
          participant.muted && <Icon name="micOff" size={14} />
        )}
      </span>
    </div>
  );
}
