import { useState, type FormEvent } from 'react';
import { LIMITS } from '@letopeiras/shared';
import { errorMessage } from '../../lib/api';
import { nameColor } from '../../lib/roles';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { useSession } from '../../state/session';
import { Avatar } from '../ui/Avatar';
import { FieldLabel } from '../ui/controls';

export function ProfileSettings() {
  const { api, chat } = useSession();
  const me = useStore(chat.store, (s) => s.me);
  const roles = useStore(chat.store, (s) => s.roles);
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState(false);

  const myRoles = roles.filter((r) => me?.roleIds.includes(r.id));
  const preview = me ? { ...me, displayName: displayName.trim() || me.displayName } : undefined;

  // The new avatar comes back through user.updated, which replaces `me`.
  const changePhoto = async (run: () => Promise<unknown>) => {
    setBusyPhoto(true);
    try {
      await run();
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusyPhoto(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateProfile({ displayName });
      showToast('Nome atualizado.', 'info');
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="settings-title">Perfil</h2>
      <div className="profile-preview">
        <Avatar user={preview} size={64} />
        <div>
          <div className="profile-name" style={{ color: nameColor(me ?? undefined, roles) }}>
            {preview?.displayName}
          </div>
          <div className="admin-row-sub">@{me?.username}</div>
          {myRoles.length > 0 && (
            <div className="tag-chips">
              {myRoles.map((role) => (
                <span
                  key={role.id}
                  className="tag-chip on"
                  style={{ borderColor: role.color, color: role.color }}
                >
                  <span className="tag-dot" style={{ background: role.color }} />
                  {role.name}
                </span>
              ))}
            </div>
          )}
          <div className="profile-photo-actions">
            <label className="button secondary small">
              {busyPhoto ? 'Enviando…' : 'Trocar foto'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                disabled={busyPhoto}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void changePhoto(() => api.setAvatar(file));
                }}
              />
            </label>
            {me?.avatarUrl && (
              <button
                type="button"
                className="button secondary small"
                disabled={busyPhoto}
                onClick={() => void changePhoto(() => api.removeAvatar())}
              >
                Remover
              </button>
            )}
          </div>
        </div>
      </div>

      <form className="settings-form" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <FieldLabel htmlFor="display-name">NOME DE EXIBIÇÃO</FieldLabel>
          <input
            id="display-name"
            className="input"
            value={displayName}
            maxLength={LIMITS.displayNameMax}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <div className="field-hint">É o nome que a galera vê no chat e na voz.</div>
        </div>
        <div>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !displayName.trim() || displayName.trim() === me?.displayName}
          >
            Salvar
          </button>
        </div>
      </form>
    </>
  );
}
