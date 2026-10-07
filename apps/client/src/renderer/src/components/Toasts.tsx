import { useStore } from '../lib/store';
import { dismissToast, toasts } from '../lib/toast';
import { dismissUpdate, update } from '../lib/update';
import { Icon } from './ui/Icon';

export function Toasts() {
  const list = useStore(toasts, (s) => s.list);
  const updateVersion = useStore(update, (s) => (s.dismissed ? null : s.version));
  if (list.length === 0 && !updateVersion) return null;
  return (
    <div className="toasts" role="status">
      {updateVersion && (
        <div className="toast info update">
          <span>A versão {updateVersion} está pronta.</span>
          <button
            type="button"
            className="button primary"
            onClick={() => void window.api.installUpdate()}
          >
            Reiniciar e atualizar
          </button>
          <button type="button" aria-label="Depois" title="Depois" onClick={dismissUpdate}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {list.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          <span>{toast.text}</span>
          <button type="button" aria-label="Fechar" onClick={() => dismissToast(toast.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
