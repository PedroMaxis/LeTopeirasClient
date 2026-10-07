import { useStore } from '../lib/store';
import { dismissToast, toasts } from '../lib/toast';
import { Icon } from './ui/Icon';

export function Toasts() {
  const list = useStore(toasts, (s) => s.list);
  if (list.length === 0) return null;
  return (
    <div className="toasts" role="status">
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
