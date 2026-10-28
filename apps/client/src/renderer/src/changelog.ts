/**
 * What's new in each version, shown once after an update (components/WhatsNew.tsx).
 * Newest first, PT-BR, one line per change; Markdown is rendered. Add an entry with every
 * release.
 */
export const CHANGELOG: { version: string; items: string[] }[] = [
  {
    version: '0.4.0',
    items: [
      '**Ouvir junto**: dentro de uma sala de voz, abra a **Música** no cabeçalho, busque no YouTube (ou cole um link do YouTube ou do Spotify) e monte a fila. Todo mundo da sala ouve a mesma música, e qualquer um pode pausar, pular ou ir para outro ponto. A música sai no dispositivo de áudio padrão do Windows, e quem usa caixa de som pode ouvir eco no microfone.',
      '**Soundboard**: o botão no painel de voz toca sons para a sala. Tem 8 prontos e você pode adicionar até 20 seus (até 5 s). Clique direito num som seu para renomear ou remover.',
      '**Abaixar o áudio quando alguém fala**: as transmissões e a música baixam enquanto alguém fala (em Voz e áudio dá para ajustar ou desligar).',
      '**Modo foco**: `Ctrl+Shift+F` na sala de voz esconde as barras laterais para o palco ocupar a janela.',
      '**Emojis**: catálogo completo com busca, seus emojis mais usados à mão e `:atalhos:` com sugestões ao digitar.',
      '**Markdown**: títulos, listas, texto pequeno, links com nome (com confirmação antes de abrir) e blocos de código coloridos com botão de copiar.',
      '**Imagens do chat**: copie ou salve pelo visualizador e pelo menu da mensagem. Cada canal lembra até onde você tinha rolado.',
      '**Foto de perfil** com recorte, **notas privadas** sobre cada pessoa no cartão de membro, e **modo não perturbe**, com notificação por canal.',
      '**Conforto**: o app lembra a posição e o tamanho da janela e volta para a chamada depois de um erro. Também ganhou zoom (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`), menu de clique direito com corretor em português, `Esc` para marcar como lido e `Ctrl+/` com todos os atalhos.',
    ],
  },
  {
    version: '0.3.1',
    items: [
      'Corrigido: no canal de voz, os quadros das pessoas podiam ficar um em cima do outro quando várias entravam seguidas.',
    ],
  },
  {
    version: '0.3.0',
    items: [
      '**Imagens**: envie até 4 por mensagem (PNG, JPEG, WebP ou GIF, até 10 MB) com o `+`, colando (`Ctrl+V`) ou arrastando para o chat. Clique numa imagem para ver em tamanho grande.',
      '**Foto de perfil**: em Configurações → Perfil, troque ou remova a sua foto; ela aparece para todo mundo.',
      '**Quem está assistindo**: cada transmissão mostra quem está vendo.',
      '**Webcam**: ligue a câmera nas salas de voz.',
    ],
  },
  {
    version: '0.2.0',
    items: [
      '**Reações**: passe o mouse numa mensagem e clique no rostinho com +; clique numa reação para somar a sua.',
      '**Respostas**: o botão de seta responde citando a mensagem (e marca a pessoa, dá para desligar no "@"). Clique na citação para ir até a original.',
      '**Busca**: o campo no topo do chat (ou `Ctrl+F`) procura em todas as mensagens, sem ligar para acentos.',
      '**Prévia de links**: sites mostram título, descrição e imagem; vídeos do YouTube tocam ali mesmo.',
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
