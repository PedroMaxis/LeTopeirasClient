import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, net } from 'electron';
import { IpcChannel, type ImageSaveResult } from '../shared/ipc';
import { imageFileName, imageHashFromUrl } from './image-url';
import { assertTrustedSender } from './renderer';

// Uploads are capped at 10 MB and stored as WebP ≤ 1920 px, so this is generous.
const MAX_BYTES = 30 * 1024 * 1024;

/** "Salvar" in the image viewer and the message menu: downloads a chat image to a chosen file. */
export function registerImageSave(): void {
  ipcMain.handle(IpcChannel.ImageSave, async (event, rawUrl: unknown): Promise<ImageSaveResult> => {
    assertTrustedSender(event);
    const hash = imageHashFromUrl(rawUrl, __SERVER_URL__);
    if (!hash) throw new Error('Not a chat image');
    const res = await net.fetch(rawUrl as string);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_BYTES) throw new Error('Image too large');

    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Salvar imagem',
      defaultPath: join(app.getPath('pictures'), imageFileName(hash)),
      filters: [{ name: 'Imagem WebP', extensions: ['webp'] }],
    };
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return 'cancelled';
    await writeFile(filePath, data);
    return 'saved';
  });
}
