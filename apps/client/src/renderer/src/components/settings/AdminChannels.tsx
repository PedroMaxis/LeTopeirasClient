import { useState, type FormEvent } from 'react';
import {
  LIMITS,
  type Category,
  type Channel,
  type ChannelType,
  type UpdateChannelRequest,
} from '@letopeiras/shared';
import { errorMessage } from '../../lib/api';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { useSession } from '../../state/session';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FieldLabel, IconButton, Segmented, ToggleRow } from '../ui/controls';
import { Icon } from '../ui/Icon';

/** Runs an admin call, showing failures as a toast. Results arrive through the gateway. */
async function attempt(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (err) {
    showToast(errorMessage(err));
    return false;
  }
}

type Deleting = { kind: 'channel'; channel: Channel } | { kind: 'category'; category: Category };

export function AdminChannels() {
  const { api, chat } = useSession();
  const channels = useStore(chat.store, (s) => s.channels);
  const categories = useStore(chat.store, (s) => s.categories);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [editing, setEditing] = useState<Channel | null>(null);

  const groups: { category: Category | null; channels: Channel[] }[] = [
    { category: null, channels: channels.filter((c) => c.categoryId === null) },
    ...categories.map((category) => ({
      category,
      channels: channels.filter((c) => c.categoryId === category.id),
    })),
  ];

  // Positions are rewritten for the whole list so swaps are always well defined.
  const moveCategory = (index: number, delta: number) => {
    const order = [...categories];
    const [moved] = order.splice(index, 1);
    if (!moved) return;
    order.splice(index + delta, 0, moved);
    void attempt(() =>
      Promise.all(
        order.flatMap((c, position) =>
          c.position === position ? [] : [api.updateCategory(c.id, { position })],
        ),
      ),
    );
  };

  const moveChannel = (list: Channel[], index: number, delta: number) => {
    const order = [...list];
    const [moved] = order.splice(index, 1);
    if (!moved) return;
    order.splice(index + delta, 0, moved);
    void attempt(() =>
      Promise.all(
        order.flatMap((c, position) =>
          c.position === position ? [] : [api.updateChannel(c.id, { position })],
        ),
      ),
    );
  };

  const confirmDelete = async () => {
    const target = deleting;
    setDeleting(null);
    if (target?.kind === 'channel') await attempt(() => api.deleteChannel(target.channel.id));
    if (target?.kind === 'category') await attempt(() => api.deleteCategory(target.category.id));
  };

  return (
    <>
      <h2 className="settings-title">Canais</h2>
      <CreateForms />

      <div className="admin-groups">
        {groups.map(({ category, channels: list }, groupIndex) => {
          if (!category && list.length === 0) return null;
          const categoryIndex = groupIndex - 1;
          return (
            <div key={category?.id ?? 'none'} className="admin-group">
              <div className="admin-group-header">
                {category ? (
                  <InlineName
                    value={category.name}
                    maxLength={LIMITS.categoryNameMax}
                    onSave={(name) => attempt(() => api.updateCategory(category.id, { name }))}
                  />
                ) : (
                  <span className="admin-group-title">Sem categoria</span>
                )}
                {category && (
                  <>
                    <IconButton
                      icon="arrowUp"
                      size={16}
                      label="Subir categoria"
                      disabled={categoryIndex === 0}
                      onClick={() => moveCategory(categoryIndex, -1)}
                    />
                    <IconButton
                      icon="arrowDown"
                      size={16}
                      label="Descer categoria"
                      disabled={categoryIndex === categories.length - 1}
                      onClick={() => moveCategory(categoryIndex, 1)}
                    />
                    <IconButton
                      icon="trash"
                      size={16}
                      label="Apagar categoria"
                      danger
                      onClick={() => setDeleting({ kind: 'category', category })}
                    />
                  </>
                )}
              </div>
              {list.length === 0 && <div className="admin-empty">Nenhum canal aqui.</div>}
              {list.map((channel, index) => (
                <div key={channel.id} className="admin-row">
                  <Icon name={channel.type === 'text' ? 'hash' : 'speaker'} size={18} />
                  <span className="admin-row-name">
                    {channel.name}
                    {channel.isPrivate && <Icon name="lock" size={14} className="inline-icon" />}
                  </span>
                  {channel.topic && <span className="admin-row-sub">{channel.topic}</span>}
                  <IconButton
                    icon="arrowUp"
                    size={16}
                    label="Subir"
                    disabled={index === 0}
                    onClick={() => moveChannel(list, index, -1)}
                  />
                  <IconButton
                    icon="arrowDown"
                    size={16}
                    label="Descer"
                    disabled={index === list.length - 1}
                    onClick={() => moveChannel(list, index, 1)}
                  />
                  <IconButton
                    icon="pencil"
                    size={16}
                    label="Editar"
                    onClick={() => setEditing(channel)}
                  />
                  <IconButton
                    icon="trash"
                    size={16}
                    label="Apagar"
                    danger
                    onClick={() => setDeleting({ kind: 'channel', channel })}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {editing && <ChannelEditor channel={editing} onClose={() => setEditing(null)} />}

      {deleting && (
        <ConfirmDialog
          title={
            deleting.kind === 'channel'
              ? `Apagar ${deleting.channel.type === 'text' ? '#' : ''}${deleting.channel.name}`
              : `Apagar a categoria ${deleting.category.name}`
          }
          confirmLabel="Apagar"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>
            {deleting.kind === 'category'
              ? 'Os canais dela não somem: vão para "Sem categoria".'
              : deleting.channel.type === 'text'
                ? 'Todas as mensagens do canal somem junto. Isso não dá para desfazer.'
                : 'Quem estiver no canal de voz vai ser desconectado.'}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

function CreateForms() {
  const { api, chat } = useSession();
  const categories = useStore(chat.store, (s) => s.categories);
  const [name, setName] = useState('');
  const [type, setType] = useState<ChannelType>('text');
  const [categoryId, setCategoryId] = useState<string>('');
  const [categoryName, setCategoryName] = useState('');

  const createChannel = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await attempt(() =>
      api.createChannel({ name, type, categoryId: categoryId ? Number(categoryId) : null }),
    );
    if (ok) setName('');
  };

  const createCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (await attempt(() => api.createCategory({ name: categoryName }))) setCategoryName('');
  };

  return (
    <>
      <form className="admin-create" onSubmit={(e) => void createChannel(e)}>
        <div className="field grow">
          <FieldLabel htmlFor="channel-name">NOVO CANAL</FieldLabel>
          <input
            id="channel-name"
            className="input"
            value={name}
            maxLength={LIMITS.channelNameMax}
            placeholder={type === 'text' ? 'memes' : 'Jogatina'}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <select
          className="select"
          aria-label="Categoria"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Sem categoria</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Segmented
          value={type}
          options={[
            { value: 'text', label: 'Texto' },
            { value: 'voice', label: 'Voz' },
          ]}
          onChange={setType}
        />
        <button type="submit" className="button primary" disabled={!name.trim()}>
          Criar
        </button>
      </form>
      <form className="admin-create" onSubmit={(e) => void createCategory(e)}>
        <div className="field grow">
          <FieldLabel htmlFor="category-name">NOVA CATEGORIA</FieldLabel>
          <input
            id="category-name"
            className="input"
            value={categoryName}
            maxLength={LIMITS.categoryNameMax}
            placeholder="Recepção"
            onChange={(e) => setCategoryName(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="button secondary" disabled={!categoryName.trim()}>
          Criar categoria
        </button>
      </form>
    </>
  );
}

/** Click-to-rename label. */
function InlineName(props: {
  value: string;
  maxLength: number;
  onSave(value: string): Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(props.value);

  const save = async () => {
    setEditing(false);
    const name = value.trim();
    if (!name || name === props.value) {
      setValue(props.value);
      return;
    }
    if (!(await props.onSave(name))) setValue(props.value);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="admin-group-title editable"
        title="Renomear"
        onClick={() => {
          setValue(props.value);
          setEditing(true);
        }}
      >
        {props.value}
        <Icon name="pencil" size={14} />
      </button>
    );
  }
  return (
    <input
      className="input small admin-inline-input"
      value={value}
      autoFocus
      maxLength={props.maxLength}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void save();
        if (e.key === 'Escape') {
          setValue(props.value);
          setEditing(false);
        }
      }}
    />
  );
}

/** Name, category, topic and who can open the channel. */
function ChannelEditor({ channel, onClose }: { channel: Channel; onClose(): void }) {
  const { api, chat } = useSession();
  const categories = useStore(chat.store, (s) => s.categories);
  const roles = useStore(chat.store, (s) => s.roles);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [categoryId, setCategoryId] = useState(channel.categoryId?.toString() ?? '');
  const [isPrivate, setIsPrivate] = useState(channel.isPrivate);
  const [roleIds, setRoleIds] = useState<number[]>(channel.roleIds);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const changes: UpdateChannelRequest = {};
    if (name.trim() !== channel.name) changes.name = name;
    if (topic.trim() !== (channel.topic ?? '')) changes.topic = topic;
    const nextCategory = categoryId ? Number(categoryId) : null;
    if (nextCategory !== channel.categoryId) changes.categoryId = nextCategory;
    if (isPrivate !== channel.isPrivate) changes.isPrivate = isPrivate;
    if ([...roleIds].sort().join() !== [...channel.roleIds].sort().join())
      changes.roleIds = roleIds;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    if (await attempt(() => api.updateChannel(channel.id, changes))) onClose();
    else setBusy(false);
  };

  const toggleRole = (id: number) =>
    setRoleIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal editor"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => void save(e)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <header className="modal-header">
          <h2>
            Editar {channel.type === 'text' ? '#' : ''}
            {channel.name}
          </h2>
          <IconButton icon="close" size={22} label="Fechar" onClick={onClose} />
        </header>
        <div className="editor-body">
          <div className="field-row">
            <div className="field">
              <FieldLabel htmlFor="edit-name">NOME</FieldLabel>
              <input
                id="edit-name"
                className="input"
                value={name}
                maxLength={LIMITS.channelNameMax}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <FieldLabel htmlFor="edit-category">CATEGORIA</FieldLabel>
              <select
                id="edit-category"
                className="select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {channel.type === 'text' && (
            <div className="field">
              <FieldLabel htmlFor="edit-topic">DESCRIÇÃO</FieldLabel>
              <input
                id="edit-topic"
                className="input"
                value={topic}
                maxLength={LIMITS.channelTopicMax}
                placeholder="Aparece no topo do canal"
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
          )}
          <ToggleRow
            label="Canal privado"
            description="Só quem tiver uma das tags abaixo abre ou entra. Os outros veem o canal com cadeado."
            checked={isPrivate}
            onChange={setIsPrivate}
          />
          {isPrivate && (
            <div className="field">
              <div className="field-label">QUEM PODE ENTRAR</div>
              {roles.length === 0 ? (
                <div className="field-hint">
                  Crie uma tag em "Tags" primeiro. Sem tag, só o admin entra.
                </div>
              ) : (
                <div className="tag-picker">
                  {roles.map((role) => (
                    <label key={role.id} className="tag-option">
                      <input
                        type="checkbox"
                        checked={roleIds.includes(role.id)}
                        onChange={() => toggleRole(role.id)}
                      />
                      <span className="tag-dot" style={{ background: role.color }} />
                      {role.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="button primary" disabled={busy || !name.trim()}>
            Salvar
          </button>
        </footer>
      </form>
    </div>
  );
}
