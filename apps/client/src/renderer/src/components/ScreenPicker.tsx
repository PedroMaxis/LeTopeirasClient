import { useEffect, useState } from 'react';
import type { ScreenSource, SystemAudioStatus } from '../../../shared/ipc';
import { errorMessage } from '../lib/api';
import { shareModeLabels, shareQualities, type ShareMode, type ShareQuality } from '../lib/media';
import { useSession } from '../state/session';
import { IconButton, Segmented, ToggleRow } from './ui/controls';

type Tab = ScreenSource['kind'];

const modeOptions = (Object.keys(shareModeLabels) as ShareMode[]).map((value) => ({
  value,
  label: shareModeLabels[value],
}));
const qualityOptions = (Object.keys(shareQualities) as ShareQuality[]).map((value) => ({
  value,
  label: shareQualities[value].label,
}));

export function ScreenPicker({ onClose }: { onClose(): void }) {
  const { voice } = useSession();
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>('window');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<ShareMode>(voice.state.shareMode);
  const [quality, setQuality] = useState<ShareQuality>(voice.state.shareQuality);
  const [withAudio, setWithAudio] = useState(voice.state.shareAudio);
  const [audioStatus, setAudioStatus] = useState<SystemAudioStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.getSystemAudioStatus().then((status) => !cancelled && setAudioStatus(status));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.api
      .getScreenSources()
      .then((list) => !cancelled && setSources(list))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const refresh = () => {
    setError(null);
    setSources(null);
    setReloadKey((key) => key + 1);
  };

  const start = (sourceId: string) => {
    onClose();
    void voice.startScreenShare(sourceId, mode, quality, withAudio && audioAvailable);
  };

  const visible = sources?.filter((s) => s.kind === tab) ?? [];
  const audioAvailable = audioStatus?.available === true;
  const audioDescription =
    audioStatus && !audioStatus.available
      ? `Indisponível neste PC: ${audioStatus.reason}.`
      : tab === 'window'
        ? 'Vai só o som desse aplicativo, sem a voz da chamada.'
        : 'Vai todo o som do PC, menos o LeTopeiras (a voz da chamada não volta).';

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal picker"
        role="dialog"
        aria-label="Compartilhar tela"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>Compartilhar tela</h2>
          <div className="modal-header-actions">
            <IconButton icon="refresh" label="Atualizar lista" onClick={refresh} />
            <IconButton icon="close" size={22} label="Fechar" onClick={onClose} />
          </div>
        </header>

        <div className="tabs">
          <button
            type="button"
            className={tab === 'window' ? 'active' : ''}
            onClick={() => setTab('window')}
          >
            Aplicativos
          </button>
          <button
            type="button"
            className={tab === 'screen' ? 'active' : ''}
            onClick={() => setTab('screen')}
          >
            Telas inteiras
          </button>
        </div>

        <div className="picker-grid">
          {error && (
            <p className="form-error">Erro ao listar o que dá para compartilhar: {error}</p>
          )}
          {!sources && !error && <p className="muted">Carregando…</p>}
          {sources && visible.length === 0 && <p className="muted">Nada para mostrar aqui.</p>}
          {visible.map((source) => (
            <button
              type="button"
              key={source.id}
              className={`source ${selectedId === source.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(source.id)}
              onDoubleClick={() => start(source.id)}
            >
              <span className="source-thumb">
                <img src={source.thumbnail} alt="" />
              </span>
              <span className="source-name">
                {source.appIcon && <img className="app-icon" src={source.appIcon} alt="" />}
                <span>{source.name}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="picker-options">
          <div className="picker-option">
            <div className="field-label">MODO</div>
            <Segmented value={mode} options={modeOptions} onChange={setMode} />
            <div className="field-hint">Jogo prioriza fluidez; Texto prioriza nitidez.</div>
          </div>
          <div className="picker-option">
            <div className="field-label">QUALIDADE</div>
            <Segmented value={quality} options={qualityOptions} onChange={setQuality} />
            <div className="field-hint">Até 6 Mbps de upload no 1080p 60.</div>
          </div>
          <div className="picker-option wide">
            <ToggleRow
              label={
                tab === 'window' ? 'Compartilhar áudio do aplicativo' : 'Compartilhar áudio do PC'
              }
              description={audioDescription}
              checked={withAudio && audioAvailable}
              disabled={!audioAvailable}
              onChange={setWithAudio}
            />
          </div>
        </div>

        <footer className="modal-footer">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!selectedId}
            onClick={() => selectedId && start(selectedId)}
          >
            Transmitir
          </button>
        </footer>
      </div>
    </div>
  );
}
