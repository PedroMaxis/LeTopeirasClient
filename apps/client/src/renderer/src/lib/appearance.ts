import { settings, type Settings } from './settings';

let spellcheck: boolean | null = null;

/** The "Aparência" settings: chat text size and spacing as CSS variables, and the spellchecker. */
function apply(s: Settings): void {
  const root = document.documentElement;
  root.style.setProperty('--chat-font-size', `${s.chatFontSize}px`);
  root.style.setProperty('--message-group-gap', `${s.messageSpacing}px`);
  if (s.spellcheck !== spellcheck) {
    spellcheck = s.spellcheck;
    void window.api.setSpellcheck(s.spellcheck);
  }
}

/** Applies the appearance settings now and whenever they change. */
export function syncAppearance(): void {
  apply(settings.get());
  settings.subscribe(() => apply(settings.get()));
}
