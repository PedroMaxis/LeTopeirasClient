import { useState, type FormEvent } from 'react';
import { LIMITS, type Role } from '@letopeiras/shared';
import { errorMessage } from '../../lib/api';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { useSession } from '../../state/session';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FieldLabel, IconButton } from '../ui/controls';

// Starting colors that read well on the dark theme.
const PALETTE = [
  '#f0782a',
  '#e8b33a',
  '#3fb56b',
  '#3aa6c9',
  '#6c8cf5',
  '#a66cf5',
  '#e05a9a',
  '#d9412f',
];

async function attempt(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (err) {
    showToast(errorMessage(err));
    return false;
  }
}

export function AdminRoles() {
  const { api, chat } = useSession();
  const roles = useStore(chat.store, (s) => s.roles);
  const users = useStore(chat.store, (s) => s.users);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0] ?? '#f0782a');
  const [deleting, setDeleting] = useState<Role | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (await attempt(() => api.createRole({ name, color }))) {
      setName('');
      setColor(PALETTE[(roles.length + 1) % PALETTE.length] ?? color);
    }
  };

  const move = (index: number, delta: number) => {
    const order = [...roles];
    const [moved] = order.splice(index, 1);
    if (!moved) return;
    order.splice(index + delta, 0, moved);
    void attempt(() =>
      Promise.all(
        order.flatMap((r, position) =>
          r.position === position ? [] : [api.updateRole(r.id, { position })],
        ),
      ),
    );
  };

  const memberCount = (roleId: number) =>
    Object.values(users).filter((u) => u.roleIds.includes(roleId)).length;

  return (
    <>
      <h2 className="settings-title">Tags</h2>
      <p className="settings-text">
        A tag colore o nome de quem a tem e libera canais privados. Quem tem várias fica com a cor
        da que estiver mais acima.
      </p>
      <form className="admin-create" onSubmit={(e) => void create(e)}>
        <div className="field grow">
          <FieldLabel htmlFor="role-name">NOVA TAG</FieldLabel>
          <input
            id="role-name"
            className="input"
            value={name}
            maxLength={LIMITS.roleNameMax}
            placeholder="Topeiros VIP"
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <FieldLabel htmlFor="role-color">COR</FieldLabel>
          <input
            id="role-color"
            type="color"
            className="color-input"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <button type="submit" className="button primary" disabled={!name.trim()}>
          Criar
        </button>
      </form>

      <div className="admin-list">
        {roles.length === 0 && <div className="admin-empty">Nenhuma tag ainda.</div>}
        {roles.map((role, index) => (
          <RoleRow
            key={role.id}
            role={role}
            members={memberCount(role.id)}
            first={index === 0}
            last={index === roles.length - 1}
            onMove={(delta) => move(index, delta)}
            onDelete={() => setDeleting(role)}
          />
        ))}
      </div>

      {deleting && (
        <ConfirmDialog
          title={`Apagar a tag ${deleting.name}`}
          confirmLabel="Apagar"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const role = deleting;
            setDeleting(null);
            void attempt(() => api.deleteRole(role.id));
          }}
        >
          <p>
            Quem tem essa tag perde ela, e quem só entrava em canais privados por causa dela perde o
            acesso.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

function RoleRow(props: {
  role: Role;
  members: number;
  first: boolean;
  last: boolean;
  onMove(delta: number): void;
  onDelete(): void;
}) {
  const { api } = useSession();
  const { role } = props;
  const [name, setName] = useState(role.name);

  const saveName = () => {
    const next = name.trim();
    if (!next || next === role.name) {
      setName(role.name);
      return;
    }
    void attempt(() => api.updateRole(role.id, { name: next })).then((ok) => {
      if (!ok) setName(role.name);
    });
  };

  return (
    <div className="admin-row">
      <input
        type="color"
        className="color-input small"
        aria-label={`Cor da tag ${role.name}`}
        // Uncontrolled, saved when the picker closes, so dragging doesn't spam the server.
        key={role.color}
        defaultValue={role.color}
        onBlur={(e) => {
          if (e.target.value !== role.color) {
            void attempt(() => api.updateRole(role.id, { color: e.target.value }));
          }
        }}
      />
      <input
        className="input small admin-inline-input"
        style={{ color: role.color }}
        value={name}
        maxLength={LIMITS.roleNameMax}
        aria-label="Nome da tag"
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="admin-row-sub">
        {props.members} {props.members === 1 ? 'pessoa' : 'pessoas'}
      </span>
      <IconButton
        icon="arrowUp"
        size={16}
        label="Subir"
        disabled={props.first}
        onClick={() => props.onMove(-1)}
      />
      <IconButton
        icon="arrowDown"
        size={16}
        label="Descer"
        disabled={props.last}
        onClick={() => props.onMove(1)}
      />
      <IconButton icon="trash" size={16} label="Apagar" danger onClick={props.onDelete} />
    </div>
  );
}
