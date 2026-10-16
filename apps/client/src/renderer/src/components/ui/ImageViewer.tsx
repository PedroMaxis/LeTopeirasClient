import { useEffect } from 'react';

/** Full-window view of one image. Click outside it, or Esc, closes it. */
export function ImageViewer({ src, onClose }: { src: string; onClose(): void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /** Downloads the image through a blob, so the save dialog gets a file name. */
  const save = async () => {
    try {
      const blob = await fetch(src).then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'imagem.webp';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      window.open(src, '_blank', 'noreferrer');
    }
  };

  return (
    <div className="image-viewer" role="dialog" aria-label="Imagem" onClick={onClose}>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <div className="image-viewer-actions" onClick={(e) => e.stopPropagation()}>
        <a className="button secondary small" href={src} target="_blank" rel="noreferrer">
          Abrir no navegador
        </a>
        <button type="button" className="button secondary small" onClick={() => void save()}>
          Salvar
        </button>
      </div>
    </div>
  );
}
