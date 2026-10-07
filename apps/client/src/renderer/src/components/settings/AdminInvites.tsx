import { useState } from 'react';
import type { InviteResponse } from '@letopeiras/shared';
import { errorMessage } from '../../lib/api';
import { formatTimestamp } from '../../lib/format';
import { showToast } from '../../lib/toast';
import { useSession } from '../../state/session';
import { FieldLabel, IconButton, Segmented } from '../ui/controls';

const DURATIONS = [
  { value: '24', label: '1 dia' },
  { value: '168', label: '7 dias' },
  { value: '720', label: '30 dias' },
];

export function AdminInvites() {
  const { api } = useSession();
  const [hours, setHours] = useState('168');
  const [busy, setBusy] = useState(false);
  // The server has no list endpoint; show the ones created in this session.
  const [invites, setInvites] = useState<InviteResponse[]>([]);

  const create = async () => {
    setBusy(true);
    try {
      const invite = await api.createInvite({ expiresInHours: Number(hours) });
      setInvites((list) => [invite, ...list]);
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      showToast('Código copiado.', 'info');
    } catch (err) {
      showToast(`Não foi possível copiar: ${errorMessage(err)}`);
    }
  };

  return (
    <>
      <h2 className="settings-title">Convites</h2>
      <p className="settings-text">
        Cada código vale para uma pessoa criar a conta. Mande por fora (WhatsApp, por exemplo).
      </p>
      <div className="admin-create">
        <div className="field">
          <FieldLabel>VALIDADE</FieldLabel>
          <Segmented value={hours} options={DURATIONS} onChange={setHours} />
        </div>
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => void create()}
        >
          Gerar convite
        </button>
      </div>
      <div className="admin-list">
        {invites.map((invite) => (
          <div key={invite.code} className="admin-row">
            <code className="invite-code">{invite.code}</code>
            <span className="admin-row-sub">vale até {formatTimestamp(invite.expiresAt)}</span>
            <IconButton
              icon="copy"
              size={16}
              label="Copiar"
              onClick={() => void copy(invite.code)}
            />
          </div>
        ))}
      </div>
    </>
  );
}
