import { settings, updateSettings } from '../../lib/settings';
import { playSound } from '../../lib/sounds';
import { useStore } from '../../lib/store';
import { Segmented, ToggleRow } from '../ui/controls';

export function NotificationSettings() {
  const s = useStore(settings, (x) => x);
  return (
    <>
      <h2 className="settings-title">Notificações</h2>
      <div className="toggle-list">
        <ToggleRow
          label="Notificações do Windows"
          description="Avisa de mensagens novas quando o LeTopeiras não está em foco."
          checked={s.notifications}
          onChange={(notifications) => updateSettings({ notifications })}
        />
        {s.notifications && (
          <div className="field">
            <div className="field-label">AVISAR DE</div>
            <Segmented
              value={s.notifyAll ? 'all' : 'mentions'}
              options={[
                { value: 'all', label: 'Todas as mensagens' },
                { value: 'mentions', label: 'Só quando me marcarem' },
              ]}
              onChange={(mode) => updateSettings({ notifyAll: mode === 'all' })}
            />
            <div className="field-hint">
              Quando alguém te marca com @, você é avisado mesmo com o app aberto em outro canal.
            </div>
          </div>
        )}
        <ToggleRow
          label="Sons"
          description="Entrar e sair da voz, alguém entrando ou saindo, transmissões, mute e ensurdecer."
          checked={s.sounds}
          onChange={(sounds) => {
            updateSettings({ sounds });
            if (sounds) playSound('join', true);
          }}
        />
      </div>
      <div className="sound-preview">
        <span className="field-hint">Ouvir:</span>
        <button
          type="button"
          className="button secondary small"
          onClick={() => playSound('join', true)}
        >
          Entrar
        </button>
        <button
          type="button"
          className="button secondary small"
          onClick={() => playSound('userJoin', true)}
        >
          Alguém entrou
        </button>
        <button
          type="button"
          className="button secondary small"
          onClick={() => playSound('mute', true)}
        >
          Mute
        </button>
        <button
          type="button"
          className="button secondary small"
          onClick={() => playSound('streamStart', true)}
        >
          Transmissão
        </button>
        <button
          type="button"
          className="button secondary small"
          onClick={() => playSound('message', true)}
        >
          Mensagem
        </button>
      </div>
    </>
  );
}
