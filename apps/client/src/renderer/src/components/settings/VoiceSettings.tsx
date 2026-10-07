import { useEffect, useRef, useState } from 'react';
import type { PushToTalkStatus } from '../../../../shared/ipc';
import { errorMessage } from '../../lib/api';
import { levelFromDb, startMicMeter } from '../../lib/audio';
import { settings, updateSettings, type Settings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { FieldLabel, ToggleRow } from '../ui/controls';

const METER_SEGMENTS = 30;

function useDevices(kind: 'audioinput' | 'audiooutput'): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void navigator.mediaDevices.enumerateDevices().then((list) => {
        if (!cancelled) setDevices(list.filter((d) => d.kind === kind));
      });
    };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [kind]);
  return devices;
}

function DeviceSelect(props: {
  id: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  value: string;
  onChange(deviceId: string): void;
}) {
  const devices = useDevices(props.kind);
  const known = devices.some((d) => d.deviceId === props.value);
  return (
    <div className="field">
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <select
        id={props.id}
        className="select"
        value={known ? props.value : 'default'}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {devices.length === 0 && <option value="default">Padrão do Windows</option>}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.deviceId === 'default'
              ? `Padrão do Windows (${d.label.replace(/^(Default|Padrão) - /, '')})`
              : d.label || 'Dispositivo sem nome'}
          </option>
        ))}
      </select>
    </div>
  );
}

function Slider(props: {
  id: string;
  label: string;
  value: number;
  max: number;
  min?: number;
  unit?: string;
  onChange(value: number): void;
}) {
  const min = props.min ?? 0;
  const unit = props.unit ?? '%';
  return (
    <div className="field">
      <FieldLabel htmlFor={props.id}>
        {props.label}{' '}
        <span className="slider-value">
          {props.value}
          {unit}
        </span>
      </FieldLabel>
      <input
        id={props.id}
        type="range"
        className="slider"
        min={min}
        max={props.max}
        value={props.value}
        style={{ ['--fill' as string]: `${((props.value - min) / (props.max - min)) * 100}%` }}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

function MicTest() {
  const s = useStore(settings, (x) => x);
  const [level, setLevel] = useState<number | null>(null);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const toggle = async () => {
    if (stop.current) {
      stop.current();
      stop.current = null;
      setLevel(null);
      return;
    }
    try {
      stop.current = await startMicMeter(
        {
          deviceId: s.inputDeviceId,
          gain: s.inputVolume / 100,
          constraints: {
            echoCancellation: s.echoCancellation,
            noiseSuppression: s.noiseSuppression === 'browser',
            autoGainControl: s.autoGainControl,
          },
          rnnoise: s.noiseSuppression === 'rnnoise',
        },
        setLevel,
      );
      setLevel(0);
    } catch (err) {
      showToast(`Não foi possível abrir o microfone: ${errorMessage(err)}`);
    }
  };

  const lit = Math.round((level ?? 0) * METER_SEGMENTS);
  // With the voice gate on, only the part above the threshold is "transmitting".
  const gate = s.voiceGate && !s.pushToTalk ? levelFromDb(s.voiceGateThreshold) : null;
  const gateSegment = gate === null ? 0 : Math.round(gate * METER_SEGMENTS);
  return (
    <div className="field">
      <div className="field-label">TESTE DE MICROFONE</div>
      <div className="mic-test">
        <button type="button" className="button primary" onClick={() => void toggle()}>
          {level === null ? 'Vamos checar' : 'Parar teste'}
        </button>
        <div className="meter" aria-hidden="true">
          {Array.from({ length: METER_SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={i < lit ? (gate !== null && lit <= gateSegment ? 'on muted' : 'on') : ''}
            />
          ))}
          {gate !== null && <i className="meter-threshold" style={{ left: `${gate * 100}%` }} />}
        </div>
      </div>
    </div>
  );
}

type NoiseSuppression = Settings['noiseSuppression'];

const NOISE_HINTS: Record<NoiseSuppression, string> = {
  off: 'Seu microfone vai como está.',
  browser: 'Tira chiado constante, como ventilador e ar-condicionado.',
  rnnoise: 'Também tira teclado, cliques e barulhos de fundo. Usa um pouco mais de CPU.',
};

type InputMode = 'auto' | 'gate' | 'ptt';

const INPUT_MODES: { mode: InputMode; title: string; description: string }[] = [
  {
    mode: 'auto',
    title: 'Detecção de voz automática',
    description: 'O microfone transmite sempre; o navegador cuida do resto.',
  },
  {
    mode: 'gate',
    title: 'Limiar manual',
    description: 'Só transmite quando sua voz passa da marca no medidor.',
  },
  {
    mode: 'ptt',
    title: 'Pressionar para falar',
    description: 'Só transmite enquanto você segura a tecla, mesmo com o app em segundo plano.',
  },
];

const MODE_SETTINGS: Record<InputMode, { voiceGate?: boolean; pushToTalk: boolean }> = {
  auto: { voiceGate: false, pushToTalk: false },
  gate: { voiceGate: true, pushToTalk: false },
  ptt: { pushToTalk: true },
};

function usePushToTalkStatus(): PushToTalkStatus | null {
  const [status, setStatus] = useState<PushToTalkStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.api.getPushToTalkStatus().then((next) => !cancelled && setStatus(next));
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

function PushToTalkKeyField() {
  const key = useStore(settings, (x) => x.pttKey);
  const [recording, setRecording] = useState(false);

  const record = async () => {
    setRecording(true);
    try {
      const next = await window.api.recordPushToTalkKey();
      if (next) updateSettings({ pttKey: next });
    } finally {
      setRecording(false);
    }
  };

  return (
    <div className="field">
      <div className="field-label">TECLA DE ATALHO</div>
      <div className="ptt-key">
        <span className={`ptt-key-name ${key ? '' : 'empty'}`}>
          {recording ? 'Aperte uma tecla ou botão do mouse…' : (key?.name ?? 'Nenhuma tecla')}
        </span>
        <button
          type="button"
          className="button primary"
          disabled={recording}
          onClick={() => void record()}
        >
          {key ? 'Trocar tecla' : 'Gravar tecla'}
        </button>
      </div>
      <span className="field-hint">
        {recording
          ? 'Esc cancela.'
          : key
            ? 'Em jogos abertos como administrador, o atalho só funciona se o LeTopeiras também for.'
            : 'Sem uma tecla, seu microfone fica fechado.'}
      </span>
    </div>
  );
}

export function VoiceSettings() {
  const s = useStore(settings, (x) => x);
  const pttStatus = usePushToTalkStatus();
  const mode: InputMode = s.pushToTalk ? 'ptt' : s.voiceGate ? 'gate' : 'auto';
  return (
    <>
      <h2 className="settings-title">Voz e áudio</h2>
      <div className="field-row">
        <DeviceSelect
          id="input-device"
          label="DISPOSITIVO DE ENTRADA"
          kind="audioinput"
          value={s.inputDeviceId}
          onChange={(inputDeviceId) => updateSettings({ inputDeviceId })}
        />
        <DeviceSelect
          id="output-device"
          label="DISPOSITIVO DE SAÍDA"
          kind="audiooutput"
          value={s.outputDeviceId}
          onChange={(outputDeviceId) => updateSettings({ outputDeviceId })}
        />
      </div>
      <div className="field-row">
        <Slider
          id="input-volume"
          label="VOLUME DE ENTRADA"
          value={s.inputVolume}
          max={200}
          onChange={(inputVolume) => updateSettings({ inputVolume })}
        />
        <Slider
          id="output-volume"
          label="VOLUME DE SAÍDA"
          value={s.outputVolume}
          max={100}
          onChange={(outputVolume) => updateSettings({ outputVolume })}
        />
      </div>
      <MicTest />
      <div className="settings-divider" />
      <div className="field">
        <div className="field-label">MODO DE ENTRADA</div>
        <div className="radio-list" role="radiogroup">
          {INPUT_MODES.map((option) => {
            const unavailable = option.mode === 'ptt' && pttStatus?.available === false;
            return (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={mode === option.mode}
                className={`radio-row ${mode === option.mode ? 'selected' : ''}`}
                disabled={unavailable}
                onClick={() => updateSettings(MODE_SETTINGS[option.mode])}
              >
                <span className="radio-dot" />
                <span>
                  <span className="radio-title">{option.title}</span>
                  <span className="radio-description">
                    {unavailable && pttStatus?.available === false
                      ? `Indisponível neste PC: ${pttStatus.reason}.`
                      : option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {mode === 'gate' && (
          <Slider
            id="gate-threshold"
            label="LIMIAR"
            value={s.voiceGateThreshold}
            min={-60}
            max={0}
            unit=" dB"
            onChange={(voiceGateThreshold) => updateSettings({ voiceGateThreshold })}
          />
        )}
      </div>
      {mode === 'ptt' && <PushToTalkKeyField />}
      <div className="settings-divider" />
      <div className="toggle-list">
        <ToggleRow
          label="Cancelamento de eco"
          description="Evita que o som dos fones volte pelo microfone."
          checked={s.echoCancellation}
          onChange={(echoCancellation) => updateSettings({ echoCancellation })}
        />
        <ToggleRow
          label="Controle automático de ganho"
          description="Mantém sua voz num volume constante."
          checked={s.autoGainControl}
          onChange={(autoGainControl) => updateSettings({ autoGainControl })}
        />
      </div>
      <div className="field">
        <FieldLabel htmlFor="noise-suppression">SUPRESSÃO DE RUÍDO</FieldLabel>
        <select
          id="noise-suppression"
          className="select"
          value={s.noiseSuppression}
          onChange={(e) => updateSettings({ noiseSuppression: e.target.value as NoiseSuppression })}
        >
          <option value="off">Desligada</option>
          <option value="browser">Padrão</option>
          <option value="rnnoise">Avançada (RNNoise)</option>
        </select>
        <span className="field-hint">{NOISE_HINTS[s.noiseSuppression]}</span>
      </div>
    </>
  );
}
