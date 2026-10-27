import {
  ipcMain,
  Menu,
  session,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { IpcChannel } from '../shared/ipc';
import { assertTrustedSender } from './renderer';

/**
 * One language, like Discord. On Windows Chromium checks pt-BR with the system spellchecker
 * (good Portuguese suggestions, no download), but adding en-US (Hunspell) leaves only the
 * English suggestions in the menu, so English words get underlined instead.
 */
const LANGUAGES = ['pt-BR'];
const MAX_SUGGESTIONS = 5;

export function registerSpellcheck(): void {
  const ses = session.defaultSession;
  const available = new Set(ses.availableSpellCheckerLanguages);
  ses.setSpellCheckerLanguages(LANGUAGES.filter((language) => available.has(language)));

  // "Corretor ortográfico" in Aparência.
  ipcMain.handle(IpcChannel.SpellcheckSet, (event, enabled: unknown) => {
    assertTrustedSender(event);
    ses.setSpellCheckerEnabled(enabled === true);
  });
}

/**
 * The native menu for text fields (spelling suggestions, cut/copy/paste) and selected text.
 * Everywhere else the page draws its own menus, which cancel the event so this never shows.
 */
export function attachContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS);
      for (const suggestion of suggestions) {
        items.push({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion),
        });
      }
      if (suggestions.length === 0) items.push({ label: 'Sem sugestões', enabled: false });
      items.push(
        {
          label: 'Adicionar ao dicionário',
          click: () =>
            win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        },
        { type: 'separator' },
      );
    }
    if (params.isEditable) {
      items.push(
        { role: 'cut', label: 'Recortar', enabled: params.editFlags.canCut },
        { role: 'copy', label: 'Copiar', enabled: params.editFlags.canCopy },
        { role: 'paste', label: 'Colar', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      );
    } else {
      items.push({ role: 'copy', label: 'Copiar' });
    }
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}
