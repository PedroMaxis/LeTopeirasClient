import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../lib/api';
import { pickImages } from '../../lib/attachments';
import { showToast } from '../../lib/toast';
import { useSession } from '../../state/session';
import { IconButton } from '../ui/controls';

export interface TrayItem {
  key: string;
  preview: string;
  progress: number;
  id: number | null;
  failed: boolean;
}

/** Images being uploaded for the next message: pick/paste/drop → upload right away. */
export function useAttachmentTray() {
  const { api } = useSession();
  const [items, setItems] = useState<TrayItem[]>([]);
  const live = useRef(items);
  useEffect(() => {
    live.current = items;
  });
  // Previews still on screen are revoked when the composer goes away.
  useEffect(() => () => live.current.forEach((i) => URL.revokeObjectURL(i.preview)), []);

  const patch = (key: string, change: Partial<TrayItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));

  const add = (files: File[]) => {
    const { accepted, errors } = pickImages(files, live.current.length);
    errors.forEach((e) => showToast(e));
    for (const file of accepted) {
      const item: TrayItem = {
        key: crypto.randomUUID(),
        preview: URL.createObjectURL(file),
        progress: 0,
        id: null,
        failed: false,
      };
      setItems((list) => [...list, item]);
      // Counted right away, so a second paste before the next render still sees the limit.
      live.current = [...live.current, item];
      api
        .uploadImage(file, (progress) => patch(item.key, { progress }))
        .then((uploaded) => patch(item.key, { id: uploaded.id, progress: 1 }))
        .catch((err: unknown) => {
          patch(item.key, { failed: true });
          showToast(`${file.name}: ${errorMessage(err)}`);
        });
    }
  };

  const remove = (key: string) =>
    setItems((list) => {
      const gone = list.find((i) => i.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return list.filter((i) => i.key !== key);
    });

  /** Hands the uploaded images to a message; their previews now belong to the pending copy. */
  const take = () => {
    const taken = {
      ids: items.flatMap((i) => (i.id ? [i.id] : [])),
      previews: items.map((i) => i.preview),
    };
    setItems([]);
    return taken;
  };

  const uploading = items.some((i) => i.id === null && !i.failed);
  const failed = items.some((i) => i.failed);
  return { items, add, remove, take, uploading, failed };
}

export function AttachmentTray({ tray }: { tray: ReturnType<typeof useAttachmentTray> }) {
  if (tray.items.length === 0) return null;
  return (
    <div className="attachment-tray">
      {tray.items.map((item) => (
        <div key={item.key} className={`attachment-thumb ${item.failed ? 'failed' : ''}`}>
          <img src={item.preview} alt="" />
          {item.id === null && !item.failed && (
            <span
              className="attachment-progress"
              style={{ width: `${Math.round(item.progress * 100)}%` }}
            />
          )}
          <IconButton
            icon="close"
            size={14}
            label="Remover imagem"
            className="attachment-remove"
            onClick={() => tray.remove(item.key)}
          />
        </div>
      ))}
    </div>
  );
}
