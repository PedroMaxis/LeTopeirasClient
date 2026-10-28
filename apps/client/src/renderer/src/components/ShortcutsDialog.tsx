import { useEffect } from 'react';
import { shortcutGroups } from '../lib/shortcuts';
import { settings } from '../lib/settings';
import { useStore } from '../lib/store';

/** Ctrl+/: every shortcut, from `lib/shortcuts.ts`. */
export function ShortcutsDialog({
  onClose,
  onOpenVoiceSettings,
}: {
  onClose(): void;
  /** Unset voice keys link to the settings page where they are chosen. */
  onOpenVoiceSettings(): void;
}) {
  const muteKey = useStore(settings, (s) => s.muteKey);
  const deafenKey = useStore(settings, (s) => s.deafenKey);
  const pttKey = useStore(settings, (s) => s.pttKey);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.ctrlKey && e.key === '/')) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal shortcuts"
        role="dialog"
        aria-label="Atalhos do teclado"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>Atalhos do teclado</h2>
        <div className="shortcuts-body">
          {shortcutGroups({ muteKey, deafenKey, pttKey }).map((group) => (
            <section key={group.title} className="shortcuts-group">
              <h3>{group.title.toUpperCase()}</h3>
              {group.items.map((item) => (
                <div key={item.label} className="shortcut-row">
                  <span>{item.label}</span>
                  {item.keys ? (
                    <span className="shortcut-keys">
                      {item.keys.split(' + ').map((part) => (
                        <kbd key={part}>{part}</kbd>
                      ))}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="shortcut-unset"
                      onClick={() => {
                        onClose();
                        onOpenVoiceSettings();
                      }}
                    >
                      Não definido · definir
                    </button>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
        <footer className="modal-footer">
          <button type="button" className="button primary" autoFocus onClick={onClose}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}
