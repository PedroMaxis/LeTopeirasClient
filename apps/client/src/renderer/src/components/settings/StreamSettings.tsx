import { useEffect, useState } from 'react';
import {
  shareModeLabels,
  shareQualities,
  type ShareMode,
  type ShareQuality,
} from '../../lib/media';
import { settings, updateSettings } from '../../lib/settings';
import { useStore } from '../../lib/store';
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
        label="Iniciar com o Windows"
        description="Abre minimizado na bandeja quando você liga o PC."
        checked={launchAtLogin === true}
        disabled={launchAtLogin === null}
        onChange={toggleLaunch}
      />
    </>
  );
}
