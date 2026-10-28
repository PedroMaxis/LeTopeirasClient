import type { Settings } from './settings';

/** One line of the shortcuts window. `keys` is "Ctrl + K" (parts split on " + "); null = not set. */
export interface Shortcut {
  label: string;
  keys: string | null;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

/**
 * Every shortcut the app has, for the Ctrl+/ window. Add new ones here so the list never goes
 * stale; the voice keys come from the settings, since people choose them.
 */
export function shortcutGroups(
  s: Pick<Settings, 'muteKey' | 'deafenKey' | 'pttKey'>,
): ShortcutGroup[] {
  return [
    {
      title: 'Navegação',
      items: [
        { label: 'Trocar de canal', keys: 'Ctrl + K' },
        { label: 'Canal anterior / próximo', keys: 'Alt + ↑ / ↓' },
        { label: 'Canal não lido anterior / próximo', keys: 'Alt + Shift + ↑ / ↓' },
        { label: 'Buscar mensagens', keys: 'Ctrl + F' },
      ],
    },
    {
      title: 'Chat',
      items: [
        { label: 'Enviar mensagem', keys: 'Enter' },
        { label: 'Quebrar linha', keys: 'Shift + Enter' },
        { label: 'Editar sua última mensagem (caixa vazia)', keys: '↑' },
        { label: 'Cancelar a resposta; depois, ir ao fim e marcar como lido', keys: 'Esc' },
        { label: 'Marcar todos os canais como lidos', keys: 'Shift + Esc' },
        { label: 'Apagar mensagem sem confirmar', keys: 'Shift + clique no lixo' },
      ],
    },
    {
      title: 'Voz',
      items: [
        { label: 'Mutar / voltar a falar', keys: s.muteKey?.name ?? null },
        { label: 'Ensurdecer / voltar a ouvir', keys: s.deafenKey?.name ?? null },
        { label: 'Falar (apertar para falar)', keys: s.pttKey?.name ?? null },
      ],
    },
    {
      title: 'Janela',
      items: [
        { label: 'Aumentar o zoom', keys: 'Ctrl + =' },
        { label: 'Diminuir o zoom', keys: 'Ctrl + -' },
        { label: 'Zoom normal (100 %)', keys: 'Ctrl + 0' },
        { label: 'Todos os atalhos', keys: 'Ctrl + /' },
        { label: 'Painel de depuração', keys: 'Ctrl + Shift + D' },
      ],
    },
  ];
}
