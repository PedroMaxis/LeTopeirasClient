import { useState, type FormEvent } from 'react';
import { LIMITS } from '@letopeiras/shared';
import { errorMessage } from '../../lib/api';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { useSession } from '../../state/session';
import { FieldLabel } from '../ui/controls';

export function AccountSettings() {
  const { api, chat } = useSession();
  const me = useStore(chat.store, (s) => s.me);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError('A confirmação não bate com a nova senha.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      showToast('Senha trocada. Os outros PCs vão precisar entrar de novo.', 'info');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="settings-title">Minha conta</h2>
      <div className="account-card">
        <div>
          <div className="field-label">USUÁRIO</div>
          <div className="account-value">@{me?.username}</div>
        </div>
        {me?.isAdmin && <span className="admin-badge">ADMIN</span>}
      </div>

      <form className="settings-form" onSubmit={(e) => void submit(e)}>
        <div className="settings-subtitle">Trocar senha</div>
        <div className="field">
          <FieldLabel htmlFor="current-password">SENHA ATUAL</FieldLabel>
          <input
            id="current-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
        <div className="field-row">
          <div className="field">
            <FieldLabel htmlFor="new-password">NOVA SENHA</FieldLabel>
            <input
              id="new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={LIMITS.passwordMin}
              maxLength={LIMITS.passwordMax}
              placeholder={`mínimo ${LIMITS.passwordMin} caracteres`}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <FieldLabel htmlFor="confirm-password">CONFIRMAR</FieldLabel>
            <input
              id="confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? 'Trocando…' : 'Trocar senha'}
          </button>
        </div>
      </form>
    </>
  );
}
