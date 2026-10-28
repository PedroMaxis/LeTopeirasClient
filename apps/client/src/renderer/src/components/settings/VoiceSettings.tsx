import { useCallback, useEffect, useRef, useState } from 'react';
import type { PushToTalkStatus } from '../../../../shared/ipc';
import { errorMessage } from '../../lib/api';
import { levelFromDb, startMicMeter } from '../../lib/audio';
import { settings, updateSettings, type Settings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { FieldLabel, Slider, ToggleRow } from '../ui/controls';

const METER_SEGMENTS = 30;

type DeviceKind = 'audioinput' | 'audiooutput' | 'videoinput';

/** Lists devices of a kind; `refreshKey` re-lists them (labels appear once access is granted). */
function useDevices(kind: DeviceKind, refreshKey = 0): MediaDeviceInfo[] {
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
  }, [kind, refreshKey]);
  return devices;
}

function DeviceSelect(props: {
  id: string;
  label: string;
  kind: DeviceKind;
  value: string;
  refreshKey?: number;
  onChange(deviceId: string): void;
}) {
  const devices = useDevices(props.kind, props.refreshKey);
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

/** Shows our camera while on. Starts and stops with the switch, the chosen device and unmount. */
function CameraTest({ deviceId, onAccess }: { deviceId: string; onAccess(): void }) {
  const [on, setOn] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!on) return;
    const el = video.current;
    let cancelled = false;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: deviceId === 'default' ? true : { deviceId: { exact: deviceId } } })
      .then((granted) => {
        // Turned off before the camera opened: release it right away.
        if (cancelled) {
          granted.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = granted;
        if (el) el.srcObject = granted;
        onAccess();
      })
      .catch((err: unknown) => {
        if (!cancelled) showToast(`Não foi possível abrir a câmera: ${errorMessage(err)}`);
      });
    return () => {
      cancelled = true;
      if (el) el.srcObject = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on, deviceId, onAccess]);

  return (
    <div className="field">
      <div className="field-label">TESTE DE CÂMERA</div>
      <div className="camera-test">
        <button
          type="button"
          className="button primary"
          aria-pressed={on}
          onClick={() => setOn((v) => !v)}
        >
          {on ? 'Parar teste' : 'Testar câmera'}
        </button>
        {on && (
          <video ref={video} className="camera-test-video mirror" autoPlay playsInline muted />
        )}
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

/** A global mute/deafen shortcut: record (with Ctrl/Shift/Alt) or clear. */
function KeybindField(props: {
  label: string;
  setting: 'muteKey' | 'deafenKey';
  disabled: boolean;
}) {
  const key = useStore(settings, (x) => x[props.setting]);
  const [recording, setRecording] = useState(false);

  const record = async () => {
    setRecording(true);
    try {
      const next = await window.api.recordKeybind();
      if (next) updateSettings({ [props.setting]: next });
    } finally {
      setRecording(false);
    }
  };

  return (
    <div className="field">
      <div className="field-label">{props.label}</div>
      <div className="ptt-key">
        <span className={`ptt-key-name ${key ? '' : 'empty'}`}>
          {recording ? 'Aperte o atalho…' : (key?.name ?? 'Nenhum atalho')}
        </span>
        {key && !recording && (
          <button
            type="button"
            className="button secondary"
            onClick={() => updateSettings({ [props.setting]: null })}
          >
            Remover
          </button>
        )}
        <button
          type="button"
          className="button primary"
          disabled={recording || props.disabled}
          onClick={() => void record()}
        >
          {key ? 'Trocar' : 'Gravar atalho'}
        </button>
      </div>
    </div>
  );
}

export function VoiceSettings() {
  const s = useStore(settings, (x) => x);
  const pttStatus = usePushToTalkStatus();
  // Bumped once the camera is allowed, so the camera list shows device names.
  const [cameraAccess, setCameraAccess] = useState(0);
  const onCameraAccess = useCallback(() => setCameraAccess((n) => n + 1), []);
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
      <KeybindField
        label="ATALHO PARA MUTAR"
        setting="muteKey"
        disabled={pttStatus?.available === false}
      />
      <KeybindField
        label="ATALHO PARA ENSURDECER"
        setting="deafenKey"
        disabled={pttStatus?.available === false}
      />
      <span className="field-hint">
        {pttStatus?.available === false
          ? `Indisponível neste PC: ${pttStatus.reason}.`
          : 'Funcionam mesmo com um jogo em foco. Segure Ctrl, Shift ou Alt junto para combinar; Esc cancela.'}
      </span>
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
        <ToggleRow
          label="Abaixar transmissões e música quando alguém fala"
          description="O áudio das transmissões e a música baixam enquanto alguém da sala fala (você incluído). As vozes nunca baixam."
          checked={s.ducking}
          onChange={(ducking) => updateSettings({ ducking })}
        />
      </div>
      {s.ducking && (
        <Slider
          id="ducking-amount"
          label="QUANTO ABAIXAR"
          value={s.duckingAmount}
          max={80}
          onChange={(duckingAmount) => updateSettings({ duckingAmount })}
        />
      )}
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
      <div className="settings-divider" />
      <DeviceSelect
        id="video-device"
        label="CÂMERA"
        kind="videoinput"
        value={s.videoDeviceId}
        refreshKey={cameraAccess}
        onChange={(videoDeviceId) => updateSettings({ videoDeviceId })}
      />
      <CameraTest deviceId={s.videoDeviceId} onAccess={onCameraAccess} />
    </>
  );
}
