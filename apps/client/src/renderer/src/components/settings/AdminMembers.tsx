import type { User } from '@letopeiras/shared';
import { errorMessage } from '../../lib/api';
import { nameColor } from '../../lib/roles';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { useSession } from '../../state/session';
import { Avatar } from '../ui/Avatar';

/** Who has which tag. Clicking a chip toggles it. */
export function AdminMembers() {
  const { api, chat } = useSession();
  const users = useStore(chat.store, (s) => s.users);
  const roles = useStore(chat.store, (s) => s.roles);

  const members = Object.values(users).sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'pt-BR'),
  );

  const toggle = async (user: User, roleId: number) => {
    const roleIds = user.roleIds.includes(roleId)
      ? user.roleIds.filter((id) => id !== roleId)
      : [...user.roleIds, roleId];
    try {
      // The new tags come back in the `ready` the server sends everyone.
      await api.setUserRoles(user.id, roleIds);
    } catch (err) {
      showToast(errorMessage(err));
    }
  };

  return (
    <>
      <h2 className="settings-title">Membros</h2>
      {roles.length === 0 && (
        <p className="settings-text">Crie uma tag em "Tags" para poder dar ela para alguém.</p>
      )}
      <div className="admin-list">
        {members.map((user) => (
          <div key={user.id} className="admin-row member-row">
            <Avatar user={user} size={32} />
            <div className="member-row-names">
              <span className="admin-row-name" style={{ color: nameColor(user, roles) }}>
                {user.displayName}
                {user.isAdmin && <span className="admin-badge">ADMIN</span>}
              </span>
              <span className="admin-row-sub">@{user.username}</span>
            </div>
            <div className="tag-chips">
              {roles.map((role) => {
                const has = user.roleIds.includes(role.id);
                return (
                  <button
                    type="button"
                    key={role.id}
                    className={`tag-chip ${has ? 'on' : ''}`}
                    style={has ? { borderColor: role.color, color: role.color } : undefined}
                    aria-pressed={has}
                    title={has ? `Tirar ${role.name}` : `Dar ${role.name}`}
                    onClick={() => void toggle(user, role.id)}
                  >
                    <span className="tag-dot" style={{ background: role.color }} />
                    {role.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
