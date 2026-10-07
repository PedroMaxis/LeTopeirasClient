import { Icon } from './ui/Icon';
import { Logo } from './ui/Logo';

/** Replaces the native frame (the window is frameless); the whole bar drags the window. */
export function TitleBar() {
  return (
    <div className="title-bar" onDoubleClick={() => void window.api.toggleMaximizeWindow()}>
      <div className="title-bar-brand">
        <Logo size={18} />
        <span className="title-bar-name">LeTopeiras</span>
        <span className="title-bar-client">CLIENT</span>
      </div>
      <div className="title-bar-buttons" onDoubleClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label="Minimizar"
          onClick={() => void window.api.minimizeWindow()}
        >
          <Icon name="minimize" size={14} />
        </button>
        <button
          type="button"
          aria-label="Maximizar"
          onClick={() => void window.api.toggleMaximizeWindow()}
        >
          <Icon name="maximize" size={12} />
        </button>
        <button
          type="button"
          aria-label="Fechar para a bandeja"
          className="close"
          onClick={() => void window.api.closeWindow()}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}
