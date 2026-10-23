import { settings, type Settings } from './settings';

/** The chat text size and spacing from the "Aparência" settings, as CSS variables. */
function apply(s: Settings): void {
  const root = document.documentElement;
  root.style.setProperty('--chat-font-size', `${s.chatFontSize}px`);
  root.style.setProperty('--message-group-gap', `${s.messageSpacing}px`);
}

/** Applies the appearance settings now and whenever they change. */
export function syncAppearance(): void {
  apply(settings.get());
  settings.subscribe(() => apply(settings.get()));
}
