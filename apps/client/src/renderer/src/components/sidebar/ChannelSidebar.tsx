import { useState } from 'react';
import type { Category, Channel, VoiceParticipant } from '@letopeiras/shared';
import { canAccess, nameColor } from '../../lib/roles';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { useSession } from '../../state/session';
import type { LayoutActions, View } from '../MainLayout';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { UserPanel } from './UserPanel';
import { VoicePanel } from './VoicePanel';
import { useVolumeMenu } from '../voice/VolumeMenu';

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

/** Text channels first, then voice, each by position (like Discord). */
const byTypeThenPosition = (a: Channel, b: Channel) =>
  (a.type === b.type ? 0 : a.type === 'text' ? -1 : 1) || a.position - b.position || a.id - b.id;

export function ChannelSidebar({ view, actions }: Props) {
  const { chat } = useSession();
  const channels = useStore(chat.store, (s) => s.channels);
  const categories = useStore(chat.store, (s) => s.categories);
  const me = useStore(chat.store, (s) => s.me);
  const [collapsed, setCollapsed] = useState(loadCollapsed);

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
          <Logo size={30} />
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
  const { category, channels, collapsed, view } = props;

  // A collapsed category still shows the open, unread and joined channels.
  const visible = collapsed
    ? channels.filter(
        (c) =>
          view?.channelId === c.id ||
          inVoice === c.id ||
          (c.lastMessageId !== null && c.lastMessageId > (readStates[c.id] ?? 0)),
      )
    : channels;

  return (
    <div className="category">
      <div className="category-header">
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

  const locked = !canAccess(me, channel);
  const kind = channel.type;
  const active = view?.kind === kind && view.channelId === channel.id;
  const unread =
    kind === 'text' &&
    !active &&
    !locked &&
    channel.lastMessageId !== null &&
    channel.lastMessageId > (readStates[channel.id] ?? 0);

  const open = () => {
    if (locked) {
      showToast('Esse canal é privado. Peça a tag para o admin.', 'info');
      return;
    }
    if (kind === 'voice' && inVoice !== channel.id) void voice.join(channel.id);
    actions.openView({ kind, channelId: channel.id });
  };

  return (
    <div>
      <button
        type="button"
        className={`channel-item ${active ? 'active' : ''} ${unread ? 'unread' : ''} ${locked ? 'locked' : ''}`}
        onClick={open}
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
  // Speaking is only known for the room we're connected to.
  const speaking = useStore(
    voice.store,
    (s) => s.channelId === channelId && s.speaking.has(String(participant.userId)),
  );
  const volumeMenu = useVolumeMenu();

  return (
    <div
      className={`voice-member ${speaking ? 'speaking' : ''}`}
      onContextMenu={volumeMenu.open(participant.userId, user?.displayName ?? '')}
    >
      {volumeMenu.menu}
      <Avatar user={user} size={22} speaking={speaking} />
      <span className="voice-member-name" style={{ color: nameColor(user, roles) }}>
        {user?.displayName ?? '…'}
      </span>
      <span className="voice-member-icons">
        {participant.screenSharing && <span className="live-badge small">AO VIVO</span>}
        {participant.deafened ? (
          <Icon name="headphonesOff" size={14} />
        ) : (
          participant.muted && <Icon name="micOff" size={14} />
        )}
      </span>
    </div>
  );
}
