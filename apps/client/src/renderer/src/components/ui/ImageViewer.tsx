import { useEffect } from 'react';
import { copyImage, saveImage } from '../../lib/images';

/** Full-window view of one chat image. Click outside it, or Esc, closes it. */
export function ImageViewer({ src, onClose }: { src: string; onClose(): void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="image-viewer" role="dialog" aria-label="Imagem" onClick={onClose}>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <div className="image-viewer-actions" onClick={(e) => e.stopPropagation()}>
        <a className="button secondary small" href={src} target="_blank" rel="noreferrer">
          Abrir no navegador
        </a>
        <button
          type="button"
          className="button secondary small"
          onClick={() => void copyImage(src)}
        >
          Copiar
        </button>
        <button
          type="button"
          className="button secondary small"
          onClick={() => void saveImage(src)}
        >
          Salvar
        </button>
      </div>
    </div>
  );
}
