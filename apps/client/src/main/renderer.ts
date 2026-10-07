import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, type IpcMainInvokeEvent } from 'electron';

export const rendererDevUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined;
export const rendererFile = join(__dirname, '../renderer/index.html');

const rendererFileUrl = pathToFileURL(rendererFile);

/** Whether a URL belongs to our own renderer (dev server or packaged file). */
export function isTrustedUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (rendererDevUrl) return url.origin === new URL(rendererDevUrl).origin;
  return url.protocol === 'file:' && url.pathname === rendererFileUrl.pathname;
}

export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedUrl(event.senderFrame?.url)) throw new Error('Untrusted IPC sender');
}
