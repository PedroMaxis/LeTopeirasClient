import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { MAX_ZOOM, MIN_ZOOM, panBy, sourceRect, zoomTo, type CropState } from '../../lib/crop';
import { showToast } from '../../lib/toast';

const BOX = 280;
const OUTPUT = 512;
const KEY_STEP = 10;
const ZOOM_STEP = 0.2;

interface Props {
  file: File;
  onCancel(): void;
  onApply(cropped: File): void;
}

const INITIAL: CropState = { zoom: 1, offset: { x: 0, y: 0 } };

export function AvatarCropper({ file, onCancel, onApply }: Props) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<CropState>(INITIAL);
  const [applying, setApplying] = useState(false);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const bigRef = useRef<HTMLCanvasElement>(null);
  const smallRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: ImageBitmap | null = null;
    createImageBitmap(file, { imageOrientation: 'from-image' }).then(
      (b) => {
        if (cancelled) b.close();
        else {
          loaded = b;
          setBitmap(b);
        }
      },
      () => {
        if (cancelled) return;
        showToast('Não deu para abrir essa imagem.');
        onCancel();
      },
    );
    return () => {
      cancelled = true;
      loaded?.close();
    };
  }, [file, onCancel]);

  useEffect(() => {
    if (!bitmap) return;
    const rect = sourceRect(crop, bitmap, BOX);
    for (const [canvas, size] of [
      [mainRef.current, BOX],
      [bigRef.current, 64],
      [smallRef.current, 32],
    ] as const) {
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) continue;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(size * ratio);
      canvas.height = Math.round(size * ratio);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        bitmap,
        rect.x,
        rect.y,
        rect.size,
        rect.size,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    }
  }, [bitmap, crop]);

  const apply = () => {
    if (!bitmap || applying) return;
    setApplying(true);
    const rect = sourceRect(crop, bitmap, BOX);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setApplying(false);
      return;
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, rect.x, rect.y, rect.size, rect.size, 0, 0, OUTPUT, OUTPUT);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setApplying(false);
          showToast('Não deu para preparar a foto.');
          return;
        }
        onApply(new File([blob], 'avatar.webp', { type: 'image/webp' }));
      },
      'image/webp',
      0.92,
    );
  };

  const zoomBy = (delta: number) => {
    if (bitmap) setCrop((c) => zoomTo(c, c.zoom + delta, bitmap, BOX));
  };

  // Always the latest closures, without re-subscribing on every drag frame.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return onCancel();
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && target.getAttribute('type') === 'range') return;
    if (e.key === 'Enter') {
      if (target.tagName !== 'BUTTON') apply();
      return;
    }
    if (!bitmap) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [KEY_STEP, 0],
      ArrowRight: [-KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setCrop((c) => panBy(c, move[0], move[1], bitmap, BOX));
    } else if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP);
    else if (e.key === '-') zoomBy(-ZOOM_STEP);
  };
  useEffect(() => {
    keyHandler.current = handleKey;
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const last = drag.current;
    if (!last || !bitmap) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setCrop((c) => panBy(c, dx, dy, bitmap, BOX));
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) =>
    zoomBy(e.deltaY < 0 ? ZOOM_STEP / 2 : -ZOOM_STEP / 2);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal avatar-cropper"
        role="dialog"
        aria-label="Recortar foto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>Recortar foto</h2>
        <div className="cropper-body">
          <div
            className="cropper-view"
            style={{ width: BOX, height: BOX }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={onWheel}
          >
            <canvas ref={mainRef} style={{ width: BOX, height: BOX }} />
            <div className="cropper-mask" />
          </div>
          <div className="cropper-side">
            <div className="field-hint">Prévia</div>
            <canvas ref={bigRef} className="cropper-preview" style={{ width: 64, height: 64 }} />
            <canvas ref={smallRef} className="cropper-preview" style={{ width: 32, height: 32 }} />
          </div>
        </div>
        <div className="cropper-zoom">
          <input
            type="range"
            className="slider"
            aria-label="Zoom"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            disabled={!bitmap}
            style={
              {
                '--fill': `${((crop.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%`,
              } as CSSProperties
            }
            onChange={(e) => {
              const zoom = Number(e.target.value);
              if (bitmap) setCrop((c) => zoomTo(c, zoom, bitmap, BOX));
            }}
          />
        </div>
        <footer className="modal-footer">
          <button type="button" className="button ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="button primary"
            autoFocus
            disabled={!bitmap || applying}
            onClick={apply}
          >
            {applying ? 'Enviando…' : 'Aplicar'}
          </button>
        </footer>
      </div>
    </div>
  );
}
