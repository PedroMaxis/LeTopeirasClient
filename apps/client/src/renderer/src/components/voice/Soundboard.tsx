import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { errorMessage } from '../../lib/api';
import { settings, updateSettings } from '../../lib/settings';
import {
  BUILTIN_SOUNDS,
  builtinBuffer,
  decodeSound,
  DEFAULT_SOUND_EMOJI,
  soundEmoji,
  soundName,
  validateCustomSound,
} from '../../lib/soundboard';
import {
  addCustomSound,
  listCustomSounds,
  putCustomSound,
  removeCustomSound,
  type CustomSound,
} from '../../lib/soundboard-db';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { useSession } from '../../state/session';
import { useContextMenu } from '../ui/ContextMenu';
import { Icon } from '../ui/Icon';

/** The form for a new custom sound (with its file) or for renaming one (with its id). */
interface Draft {
  id?: number;
  bytes?: ArrayBuffer;
  name: string;
  emoji: string;
}

/** Soundboard popover over the voice panel: click a sound and the room hears it. */
export function SoundboardPopover({ onClose }: { onClose(): void }) {
  const { voice } = useSession();
  const volume = useStore(settings, (s) => s.soundboardVolume);
  const [custom, setCustom] = useState<CustomSound[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const menu = useContextMenu();
  /** Decoded custom sounds, so a repeated click doesn't decode again. */
  const decoded = useRef(new Map<number, AudioBuffer>());

  useEffect(() => {
    let cancelled = false;
    void listCustomSounds()
      .then((sounds) => {
        if (!cancelled) setCustom(sounds);
      })
      .catch((err: unknown) => showToast(`Não deu para abrir seus sons: ${errorMessage(err)}`));
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const play = async (load: () => Promise<AudioBuffer>) => {
    try {
      if (!voice.playSoundboard(await load())) {
        showToast('Desmute para usar o soundboard', 'info');
      }
    } catch (err) {
      showToast(`Não deu para tocar o som: ${errorMessage(err)}`);
    }
  };

  const playCustom = (sound: CustomSound) =>
    play(async () => {
      let buffer = decoded.current.get(sound.id);
      if (!buffer) {
        buffer = await decodeSound(sound.bytes);
        decoded.current.set(sound.id, buffer);
      }
      return buffer;
    });

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    try {
      const bytes = await picked.arrayBuffer();
      let seconds = Number.NaN;
      if (bytes.byteLength <= 1024 * 1024) {
        seconds = (await decodeSound(bytes)).duration;
      }
      const problem = validateCustomSound({
        bytes: bytes.byteLength,
        seconds: bytes.byteLength > 1024 * 1024 ? 1 : seconds,
        existing: custom.length,
      });
      if (problem) return showToast(problem, 'info');
      setDraft({ bytes, name: soundName(picked.name), emoji: DEFAULT_SOUND_EMOJI });
    } catch {
      showToast('Não deu para ler esse áudio. Use um arquivo mp3, ogg ou wav.', 'info');
    }
  };

  const save = async () => {
    if (!draft) return;
    const name = soundName(draft.name);
    const emoji = soundEmoji(draft.emoji);
    try {
      if (draft.id !== undefined) {
        const current = custom.find((c) => c.id === draft.id);
        if (current) {
          const next = { ...current, name, emoji };
          await putCustomSound(next);
          setCustom((list) => list.map((c) => (c.id === next.id ? next : c)));
        }
      } else if (draft.bytes) {
        const id = await addCustomSound({ name, emoji, bytes: draft.bytes });
        setCustom((list) => [...list, { id, name, emoji, bytes: draft.bytes as ArrayBuffer }]);
      }
      setDraft(null);
    } catch (err) {
      showToast(`Não deu para salvar o som: ${errorMessage(err)}`);
    }
  };

  const remove = async (sound: CustomSound) => {
    try {
      await removeCustomSound(sound.id);
      decoded.current.delete(sound.id);
      setCustom((list) => list.filter((c) => c.id !== sound.id));
    } catch (err) {
      showToast(`Não deu para remover o som: ${errorMessage(err)}`);
    }
  };

  return (
    <>
      <div className="soundboard-backdrop" onMouseDown={onClose} />
      <div className="soundboard" role="dialog" aria-label="Soundboard">
        <div className="soundboard-grid">
          {BUILTIN_SOUNDS.map((sound) => (
            <button
              key={sound.id}
              type="button"
              className="sound-button"
              onClick={() => void play(() => builtinBuffer(sound))}
            >
              <span className="sound-emoji">{sound.emoji}</span>
              <span className="sound-name">{sound.name}</span>
            </button>
          ))}
        </div>

        <div className="soundboard-title">MEUS SONS</div>
        <div className="soundboard-grid">
          {custom.map((sound) => (
            <button
              key={sound.id}
              type="button"
              className="sound-button"
              title="Clique direito: renomear ou remover"
              onClick={() => void playCustom(sound)}
              onContextMenu={(event) =>
                menu.open(event, [
                  {
                    label: 'Renomear',
                    onSelect: () =>
                      setDraft({ id: sound.id, name: sound.name, emoji: sound.emoji }),
                  },
                  { label: 'Remover', danger: true, onSelect: () => void remove(sound) },
                ])
              }
            >
              <span className="sound-emoji">{sound.emoji}</span>
              <span className="sound-name">{sound.name}</span>
            </button>
          ))}
          <button
            type="button"
            className="sound-button add"
            title="Adicionar um som (até 5 s e 1 MB)"
            onClick={() => file.current?.click()}
          >
            <Icon name="plus" size={22} />
            <span className="sound-name">Adicionar</span>
          </button>
        </div>
        <input ref={file} type="file" accept="audio/*" hidden onChange={(e) => void pickFile(e)} />

        {draft && (
          <form
            className="soundboard-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              className="input emoji"
              aria-label="Emoji"
              value={draft.emoji}
              maxLength={16}
              onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
            />
            <input
              className="input name"
              aria-label="Nome do som"
              value={draft.name}
              maxLength={24}
              autoFocus
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <button type="submit" className="button primary small">
              Salvar
            </button>
          </form>
        )}

        <label className="soundboard-title" htmlFor="soundboard-volume">
          VOLUME <span className="slider-value">{volume}%</span>
        </label>
        <input
          id="soundboard-volume"
          type="range"
          className="slider"
          min={0}
          max={100}
          step={5}
          value={volume}
          style={{ ['--fill' as string]: `${volume}%` }}
          onChange={(e) => updateSettings({ soundboardVolume: Number(e.target.value) })}
        />
        {menu.menu}
      </div>
    </>
  );
}
