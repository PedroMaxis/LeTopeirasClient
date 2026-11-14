import { useEffect, useState } from 'react';
import {
  shareModeLabels,
  shareQualities,
  type ShareMode,
  type ShareQuality,
} from '../../lib/media';
import { settings, updateSettings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import type { ParsecEchoStatus } from '../../../../shared/ipc';
import { Segmented, ToggleRow } from '../ui/controls';

const modeOptions = (Object.keys(shareModeLabels) as ShareMode[]).map((value) => ({
  value,
  label: shareModeLabels[value],
}));
const qualityOptions = (Object.keys(shareQualities) as ShareQuality[]).map((value) => ({
  value,
  label: shareQualities[value].label,
}));

export function StreamSettings() {
  const s = useStore(settings, (x) => x);
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.getLaunchAtLogin().then((on) => !cancelled && setLaunchAtLogin(on));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleLaunch = (enabled: boolean) => {
    setLaunchAtLogin(enabled);
    void window.api.setLaunchAtLogin(enabled);
  };

  const quality = shareQualities[s.defaultShareQuality];

  return (
    <>
      <h2 className="settings-title">Transmissão</h2>
      <div className="field">
        <div className="field-label">QUALIDADE PADRÃO</div>
        <Segmented
          value={s.defaultShareQuality}
          options={qualityOptions}
          onChange={(defaultShareQuality) => updateSettings({ defaultShareQuality })}
        />
        <div className="field-hint">
          Até {(quality.maxBitrate / 1_000_000).toLocaleString('pt-BR')} Mbps de upload. Dá para
          trocar na hora de transmitir.
        </div>
      </div>
      <div className="field">
        <div className="field-label">MODO PADRÃO</div>
        <Segmented
          value={s.defaultShareMode}
          options={modeOptions}
          onChange={(defaultShareMode) => updateSettings({ defaultShareMode })}
        />
        <div className="field-hint">Jogo prioriza fluidez; Texto prioriza nitidez.</div>
      </div>
      <ToggleRow
        label="Preferir H.264"
        description="Codifica a tela no processador em vez da placa de vídeo. Use se o app travar ou ficar com a tela escura enquanto você transmite. Vale a partir da próxima transmissão."
        checked={s.preferH264}
        onChange={(preferH264) => updateSettings({ preferH264 })}
      />
      <ToggleRow
        label="Assistir transmissões automaticamente"
        description="Desligado, a transmissão dos outros só aparece quando você clica em Assistir, e até lá não gasta sua internet."
        checked={s.autoWatchShares}
        onChange={(autoWatchShares) => updateSettings({ autoWatchShares })}
      />
      <div className="settings-divider" />
      <ToggleRow
        label="Iniciar com o sistema"
        description="Abre minimizado na bandeja quando você liga o PC."
        checked={launchAtLogin === true}
        disabled={launchAtLogin === null}
        onChange={toggleLaunch}
      />
      <ParsecEcho />
    </>
  );
}

const parsecOptions = [
  { value: 'letopeiras', label: 'LeTopeiras' },
  { value: 'discord', label: 'Discord' },
] as const;

const parsecResultText: Record<'running' | 'not-found' | 'failed', string> = {
  running: 'Feche o Parsec antes (ícone na bandeja → Quit) e clique de novo.',
  'not-found': 'Não achei a configuração do Parsec neste PC.',
  failed: 'Não consegui alterar a configuração do Parsec.',
};

/** Which app Parsec keeps out of what its guests hear when this PC hosts (Windows only). */
function ParsecEcho() {
  const [status, setStatus] = useState<ParsecEchoStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => void window.api.getParsecEcho().then((s) => !cancelled && setStatus(s));
    refresh();
    // Closing Parsec happens in the tray; recheck when the person comes back.
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
    };
  }, []);

  if (!status?.available) return null;

  const apply = async (target: 'letopeiras' | 'discord') => {
    if (busy || target === status.target) return;
    setBusy(true);
    try {
      const result = await window.api.setParsecEcho(target);
      if (result.ok) {
        showToast(
          result.reopened
            ? 'Pronto! O Parsec abriu de novo com a configuração nova.'
            : 'Pronto! Vale na próxima vez que você abrir o Parsec.',
          'info',
        );
      } else {
        showToast(parsecResultText[result.reason]);
      }
      setStatus(await window.api.getParsecEcho());
    } finally {
      setBusy(false);
    }
  };

  const current =
    status.target === 'other'
      ? ' Agora ele está ignorando outro app, escolhido à mão.'
      : status.target === 'off'
        ? ' Agora o cancelamento de eco dele está desligado.'
        : '';

  return (
    <>
      <div className="settings-divider" />
      <div className="field">
        <div className="field-label">PARSEC: SOM QUE NÃO VAI PARA OS CONVIDADOS</div>
        <Segmented
          value={status.target}
          options={parsecOptions}
          onChange={(target) => void apply(target as 'letopeiras' | 'discord')}
        />
        <div className="field-hint">
          Quando você hospeda no Parsec, quem conecta não ouve o app escolhido aqui. Escolha
          LeTopeiras para a call não vazar; o Parsec só ignora um app por vez.{current}
          {status.running && ' Para trocar, feche o Parsec antes; ele abre de novo sozinho.'}
        </div>
      </div>
    </>
  );
}
