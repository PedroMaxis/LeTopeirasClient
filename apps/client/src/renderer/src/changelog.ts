/**
 * What's new in each version, shown once after an update (components/WhatsNew.tsx).
 * Newest first, PT-BR, one line per change; Markdown is rendered. Add an entry with every
 * release.
 */
export const CHANGELOG: { version: string; items: string[] }[] = [
  {
    version: '0.2.0',
    items: [
      '**Reações**: passe o mouse numa mensagem e clique no rostinho com +; clique numa reação para somar a sua.',
      '**Respostas**: o botão de seta responde citando a mensagem (e marca a pessoa, dá para desligar no "@"). Clique na citação para ir até a original.',
      '**Busca**: o campo no topo do chat (ou `Ctrl+F`) procura em todas as mensagens, sem ligar para acentos.',
      '**Prévia de links**: sites mostram título, descrição e imagem; vídeos do YouTube tocam ali mesmo.',
    ],
  },
  {
    version: '0.1.6',
    items: [
      'Animação de abertura: a topeira cava o nome do app (dá para desligar em Configurações → Transmissão).',
      'A topeira ganhou vida no login, na reconexão e no começo dos canais. Clique nela no canto superior esquerdo!',
      'No canal de voz, os quadros deslizam até o lugar novo quando alguém transmite, entra ou você troca de foco.',
      '`Ctrl+K` para pular para qualquer canal digitando o nome; `Alt+↑/↓` vai ao canal anterior ou próximo (com `Shift`, só os não lidos).',
      'O ícone na barra de tarefas mostra quantas marcações você tem e pisca quando alguém te marca.',
      'Clique no nome ou no avatar de alguém para ver o perfil, ajustar o volume e marcar a pessoa.',
      'Mensagens com formatação: `**negrito**`, `*itálico*`, `~~riscado~~`, `||spoiler||`, `> citação`, código entre crases e blocos de código com três crases.',
    ],
  },
  {
    version: '0.1.5',
    items: [
      'Várias transmissões ao mesmo tempo, em grade; clique numa para dar foco.',
      'Transmissões só aparecem quando você clica em **Assistir** (dá para voltar ao automático em Transmissão).',
      'Atalhos globais para mutar e ensurdecer, e controles de voz no menu da bandeja.',
      'Aviso de "Você está mutado" quando você fala mutado, e a borda verde de quem fala acende na hora.',
      'Chat ao lado do palco de voz, separador de datas, `↑` para editar a última mensagem.',
    ],
  },
  {
    version: '0.1.4',
    items: [
      'Ensurdecer não silencia mais o áudio das transmissões.',
      'Janela flutuante (picture-in-picture) e volume próprio para cada transmissão.',
      'Rascunho guardado por canal e botão "Ir para o fim" com as mensagens novas.',
    ],
  },
];

/** -1, 0 or 1, comparing "major.minor.patch" versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/** Entries newer than `seen` up to `current` (at most three versions back). */
export function notesSince(seen: string, current: string) {
  return CHANGELOG.filter(
    (entry) =>
      compareVersions(entry.version, seen) > 0 && compareVersions(entry.version, current) <= 0,
  ).slice(0, 3);
}
