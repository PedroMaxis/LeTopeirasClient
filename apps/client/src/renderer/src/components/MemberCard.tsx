import { useEffect, useState, type MouseEvent } from 'react';
import { canAccess, topRole } from '../lib/roles';
import { settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { useSession } from '../state/session';
import { Avatar } from './ui/Avatar';

/** Window event the composer listens to, to insert "@username " where the cursor is. */
export const INSERT_MENTION_EVENT = 'letopeiras:insert-mention';

const CARD_WIDTH = 300;
const CARD_HEIGHT = 340; // tallest case, for keeping it inside the window

interface Target {
  userId: number;
  anchor: DOMRect;
}

/**
 * Profile card that opens next to whatever was clicked (a name or avatar in the chat, a row
 * in the member list). Returns the click handler factory and the element to render.
 */
export function useMemberCard() {
  const [target, setTarget] = useState<Target | null>(null);
  const open = (userId: number) => (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setTarget({ userId, anchor: event.currentTarget.getBoundingClientRect() });
  };
  const card = target ? <MemberCard target={target} onClose={() => setTarget(null)} /> : null;
  return { open, card };
}

function MemberCard({ target, onClose }: { target: Target; onClose(): void }) {
  const { chat, voice } = useSession();
  const user = useStore(chat.store, (s) => s.users[target.userId]);
  const me = useStore(chat.store, (s) => s.me);
  const roles = useStore(chat.store, (s) => s.roles);
  const presence = useStore(chat.store, (s) => s.presence.get(target.userId));
  const channels = useStore(chat.store, (s) => s.channels);
  const voiceStates = useStore(chat.store, (s) => s.voice);
  const myRoom = useStore(voice.store, (s) => s.channelId);
  const volume = useStore(settings, (s) => s.userVolumes[String(target.userId)] ?? 100);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!user) return null;
  const isMe = user.id === me?.id;
  const status = presence ?? 'offline';
  const statusLabel = { online: 'Online', idle: 'Ausente', offline: 'Offline' }[status];

  // "Em voz · Geral" / "Transmitindo · Geral", only for channels we can see into.
  let activity: string | null = null;
  let inMyRoom = false;
  for (const [channelId, participants] of Object.entries(voiceStates)) {
    const p = participants.find((v) => v.userId === user.id);
    const channel = channels.find((c) => c.id === Number(channelId));
    if (!p || !channel || !canAccess(me, channel)) continue;
    activity = `${p.screenSharing ? 'Transmitindo' : 'Em voz'} · ${channel.name}`;
    inMyRoom = channel.id === myRoom;
  }
  const userRoles = roles.filter((r) => user.roleIds.includes(r.id));

  // Beside the anchor, flipped to its left if it doesn't fit, always inside the window.
  const { anchor } = target;
  const fitsRight = anchor.right + 8 + CARD_WIDTH < window.innerWidth;
  const left = fitsRight ? anchor.right + 8 : Math.max(8, anchor.left - 8 - CARD_WIDTH);
  const top = Math.max(38, Math.min(anchor.top, window.innerHeight - CARD_HEIGHT - 8));

  return (
    <div className="context-backdrop" onMouseDown={onClose}>
      <div
        className="member-card"
        role="dialog"
        aria-label={`Perfil de ${user.displayName}`}
        style={{ left, top, width: CARD_WIDTH }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="member-card-banner"
          style={{ background: topRole(user, roles)?.color ?? 'var(--accent)' }}
        />
        <div className="member-card-avatar">
          <Avatar user={user} size={72} status={status} />
        </div>
        <div className="member-card-body">
          <div className="member-card-name">{user.displayName}</div>
          <div className="member-card-username">
            @{user.username}
            {user.isAdmin && <span className="member-card-admin">Admin</span>}
          </div>
          <div className={`member-card-status ${status}`}>
            <span className={`presence-dot inline ${status}`} />
            {activity ?? statusLabel}
          </div>
          {userRoles.length > 0 && (
            <div className="member-card-roles">
              {userRoles.map((role) => (
                <span key={role.id} className="role-chip">
                  <span className="role-dot" style={{ background: role.color }} />
                  {role.name}
                </span>
              ))}
            </div>
          )}
          {inMyRoom && !isMe && (
            <label className="field-label" htmlFor="card-volume">
              VOLUME <span className="slider-value">{volume}%</span>
              <input
                id="card-volume"
                type="range"
                className="slider"
                min={0}
                max={200}
                step={5}
                value={volume}
                style={{ ['--fill' as string]: `${volume / 2}%` }}
                onChange={(e) => voice.setUserVolume(user.id, Number(e.target.value))}
              />
            </label>
          )}
          {!isMe && (
            <button
              type="button"
              className="button primary small"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent(INSERT_MENTION_EVENT, { detail: user.username }),
                );
                onClose();
              }}
            >
              Marcar @{user.username}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
