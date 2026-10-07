import type { User } from '@letopeiras/shared';
import { canAccess, topRole } from '../lib/roles';
import { useStore } from '../lib/store';
import { useSession } from '../state/session';
import { Avatar } from './ui/Avatar';

const byName = (a: User, b: User) => a.displayName.localeCompare(b.displayName, 'pt-BR');

/** Online members grouped by their first tag (like Discord's hoisted roles), then offline. */
export function MemberList() {
  const { chat } = useSession();
  const users = useStore(chat.store, (s) => s.users);
  const presence = useStore(chat.store, (s) => s.presence);
  const voice = useStore(chat.store, (s) => s.voice);
  const channels = useStore(chat.store, (s) => s.channels);
  const roles = useStore(chat.store, (s) => s.roles);
  const me = useStore(chat.store, (s) => s.me);

  const all = Object.values(users).sort(byName);
  const online = all.filter((u) => presence.has(u.id));
  const offline = all.filter((u) => !presence.has(u.id));

  // "Transmitindo · Geral" / "Em voz · Geral" (only for channels we can see into).
  const activity = new Map<number, string>();
  for (const [channelId, participants] of Object.entries(voice)) {
    const channel = channels.find((c) => c.id === Number(channelId));
    if (!channel || !canAccess(me, channel)) continue;
    for (const p of participants) {
      activity.set(p.userId, `${p.screenSharing ? 'Transmitindo' : 'Em voz'} · ${channel.name}`);
    }
  }

  const groups = roles
    .map((role) => ({
      key: `role-${role.id}`,
      label: role.name.toUpperCase(),
      members: online.filter((u) => topRole(u, roles)?.id === role.id),
    }))
    .filter((g) => g.members.length > 0);
  const untagged = online.filter((u) => !topRole(u, roles));
  if (untagged.length) groups.push({ key: 'online', label: 'ONLINE', members: untagged });

  return (
    <aside className="member-list">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="member-section">
            {group.label} — {group.members.length}
          </div>
          {group.members.map((user) => {
            const idle = presence.get(user.id) === 'idle';
            const sub = activity.get(user.id) ?? (idle ? 'Ausente' : null);
            return (
              <div key={user.id} className="member">
                <Avatar user={user} size={32} status={idle ? 'idle' : 'online'} />
                <div className="member-names">
                  <div className="member-name" style={{ color: topRole(user, roles)?.color }}>
                    {user.displayName}
                  </div>
                  {sub && <div className="member-sub">{sub}</div>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {offline.length > 0 && <div className="member-section">OFFLINE — {offline.length}</div>}
      {offline.map((user) => (
        <div key={user.id} className="member offline">
          <Avatar user={user} size={32} status="offline" />
          <div className="member-name" style={{ color: topRole(user, roles)?.color }}>
            {user.displayName}
          </div>
        </div>
      ))}
    </aside>
  );
}
