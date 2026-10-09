import { useEffect, useState } from 'react';
import type { ScreenSource, SystemAudioStatus } from '../../../shared/ipc';
import { errorMessage } from '../lib/api';
import { shareModeLabels, shareQualities, type ShareMode, type ShareQuality } from '../lib/media';
import { useSession } from '../state/session';
import { IconButton, Segmented, ToggleRow } from './ui/controls';

type Tab = ScreenSource['kind'];

/** Last tab and source shared on this PC, pre-selected next time if it's still there. */
const LAST_KEY = 'letopeiras.lastShareSource';

function loadLast(): { tab: Tab; id: string | null } {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as {
      tab?: unknown;
      id?: unknown;
    } | null;
    return {
      tab: last?.tab === 'screen' ? 'screen' : 'window',
      id: typeof last?.id === 'string' ? last.id : null,
    };
  } catch {
    return { tab: 'window', id: null };
  }
}

function saveLast(tab: Tab, id: string): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ tab, id }));
  } catch {
    // Only a convenience.
  }
}

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
  const [last] = useState(loadLast);
  const [tab, setTab] = useState<Tab>(last.tab);
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
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        if (list.some((s) => s.id === last.id)) setSelectedId(last.id);
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [reloadKey, last.id]);

  const refresh = () => {
    setError(null);
    setSources(null);
    setReloadKey((key) => key + 1);
  };

  const audioAvailable = audioStatus?.available === true;

  const start = (sourceId: string) => {
    const kind = sources?.find((s) => s.id === sourceId)?.kind ?? tab;
    saveLast(kind, sourceId);
    onClose();
    void voice.startScreenShare(sourceId, mode, quality, withAudio && audioAvailable);
  };

  const visible = sources?.filter((s) => s.kind === tab) ?? [];
  const selectedVisible = visible.some((s) => s.id === selectedId) ? selectedId : null;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && selectedVisible) {
        // Otherwise the focused button behind the modal (e.g. "Tela") would click again.
        e.preventDefault();
        start(selectedVisible);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
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
              className={`source ${selectedVisible === source.id ? 'selected' : ''}`}
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
            disabled={!selectedVisible}
            onClick={() => selectedVisible && start(selectedVisible)}
          >
            Transmitir
          </button>
        </footer>
      </div>
    </div>
  );
}
