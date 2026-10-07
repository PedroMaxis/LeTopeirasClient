import { desktopCapturer, ipcMain, webContents, type Session } from 'electron';
import { z } from 'zod';
import { IpcChannel, type ScreenSource } from '../shared/ipc';
import { assertTrustedSender, isTrustedUrl } from './renderer';

const SELECTION_TTL_MS = 30_000;
const THUMBNAIL_SIZE = { width: 320, height: 180 };

const sourceIdSchema = z.string().regex(/^(screen|window):[\w:-]+$/);

/** Source picked in our own UI, keyed by the webContents id that will call getDisplayMedia. */
const pendingSelections = new Map<number, { sourceId: string; expiresAt: number }>();

export function registerScreenCapture(ses: Session): void {
  ipcMain.handle(IpcChannel.GetScreenSources, async (event): Promise<ScreenSource[]> => {
    assertTrustedSender(event);
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: THUMBNAIL_SIZE,
      fetchWindowIcons: true,
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
    }));
  });

  ipcMain.handle(IpcChannel.SelectScreenSource, (event, rawSourceId: unknown) => {
    assertTrustedSender(event);
    const sourceId = sourceIdSchema.parse(rawSourceId);
    pendingSelections.set(event.sender.id, { sourceId, expiresAt: Date.now() + SELECTION_TTL_MS });
  });

  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const reject = () => callback({});
      const frame = request.frame;
      if (!frame || !isTrustedUrl(frame.url)) return reject();

      const contents = webContents.fromFrame(frame);
      const selection = contents ? pendingSelections.get(contents.id) : undefined;
      if (contents) pendingSelections.delete(contents.id);
      if (!selection || selection.expiresAt < Date.now()) return reject();

      desktopCapturer
        .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const source = sources.find((s) => s.id === selection.sourceId);
          if (!source) return reject();
          // System audio is added in Phase 5 through the native loopback addon.
          callback({ video: source });
        })
        .catch(reject);
    },
    { useSystemPicker: false },
  );
}
