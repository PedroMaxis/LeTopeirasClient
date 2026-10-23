import type { User } from '@letopeiras/shared';
import { settings, updateSettings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import { Avatar } from '../ui/Avatar';
import { Segmented, Slider, ToggleRow } from '../ui/controls';

const SPACING_OPTIONS = [0, 4, 8, 14, 24].map((px) => ({ value: String(px), label: `${px} px` }));

type PreviewUser = Pick<User, 'id' | 'displayName' | 'avatarUrl'>;

/** Someone else in the preview, so the space between groups shows. */
const MOLE: PreviewUser = { id: 6, displayName: 'Topeira', avatarUrl: null };

export function AppearanceSettings() {
  const s = useStore(settings, (x) => x);
  return (
    <>
      <h2 className="settings-title">Aparência</h2>
      <AppearancePreview />
      <Slider
        id="chat-font-size"
        label="TAMANHO DA FONTE DO CHAT"
        value={s.chatFontSize}
        min={12}
        max={20}
        unit=" px"
        onChange={(chatFontSize) => updateSettings({ chatFontSize })}
      />
      <div className="field">
        <div className="field-label">ESPAÇO ENTRE GRUPOS DE MENSAGENS</div>
        <Segmented
          value={String(s.messageSpacing)}
          options={SPACING_OPTIONS}
          onChange={(value) => updateSettings({ messageSpacing: Number(value) })}
        />
      </div>
      <ToggleRow
        label="Modo compacto"
        description="Uma linha por mensagem, com a hora e o nome na frente e sem foto. Cabe mais conversa na tela."
        checked={s.compactMode}
        onChange={(compactMode) => updateSettings({ compactMode })}
      />
      <div className="settings-divider" />
      <ToggleRow
        label="Animação de abertura"
        description="A topeira cavando o nome do app ao abrir. Clique ou aperte uma tecla para pular."
        checked={s.introAnimation}
        onChange={(introAnimation) => updateSettings({ introAnimation })}
      />
    </>
  );
}

/** Two sample messages with the classes the chat uses, so every setting shows right away. */
function AppearancePreview() {
  const { chat } = useSession();
  const me = useStore(chat.store, (s) => s.me);
  const compact = useStore(settings, (s) => s.compactMode);
  const lines: { user: PreviewUser; text: string; grouped: boolean; time: string }[] = [
    { user: MOLE, text: 'Bora uma call hoje?', grouped: false, time: '14:30' },
    { user: MOLE, text: 'Eu levo a pipoca 🍿', grouped: true, time: '14:30' },
    { user: me ?? MOLE, text: 'Bora! Olha o tamanho da letra 👀', grouped: false, time: '14:32' },
  ];
  return (
    <div className="appearance-preview messages" aria-hidden="true">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`message ${compact ? 'compact' : ''} ${line.grouped ? 'grouped' : ''}`}
        >
          {!compact &&
            (line.grouped ? (
              <span className="message-gutter-time" />
            ) : (
              <Avatar user={line.user} size={40} />
            ))}
          <div className="message-body">
            {compact ? (
              <span className="message-header">
                <span className="message-compact-time">{line.time}</span>
                <span className="message-author">{line.user.displayName}</span>
              </span>
            ) : (
              !line.grouped && (
                <div className="message-header">
                  <span className="message-author">{line.user.displayName}</span>
                  <span className="message-time">Hoje às {line.time}</span>
                </div>
              )
            )}
            <div className="message-content">{line.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
