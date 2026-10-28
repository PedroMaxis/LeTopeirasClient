import { showToast } from './toast';

/**
 * Copies a chat image to the clipboard as PNG (Windows doesn't paste WebP). An animated GIF
 * copies its first frame.
 */
export async function copyImage(url: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), 'image/png'),
    );
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    showToast('Imagem copiada.', 'info');
  } catch {
    showToast('Não deu para copiar a imagem.');
  }
}

/** Asks main to download the image and open a save dialog. */
export async function saveImage(url: string): Promise<void> {
  try {
    if ((await window.api.saveImage(url)) === 'saved') showToast('Imagem salva.', 'info');
  } catch {
    showToast('Não deu para salvar a imagem.');
  }
}
