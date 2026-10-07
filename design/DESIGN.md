# LeTopeiras Client — guia visual

Referência visual do frontend. As telas em `telas/` são **mockups em HTML estático (1280×800)**,
não código de produção: use-as como guia de layout, cores, tamanhos e textos, e reimplemente
como componentes no renderer do Electron.

## Telas

| Arquivo                         | Tela                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `telas/01-login.html`           | Login                                                                              |
| `telas/02-registro.html`        | Registro com código de convite                                                     |
| `telas/03-chat.html`            | Layout principal: canais à esquerda, chat no centro, membros à direita             |
| `telas/04-voz.html`             | Canal de voz com transmissão em destaque, grade de participantes e controles       |
| `telas/05-seletor-de-tela.html` | Modal de compartilhar tela (app/tela, modo Jogo ou Texto/Código, qualidade, áudio) |
| `telas/06-config-audio.html`    | Configurações de voz e áudio                                                       |

Abra os arquivos no navegador para ver. Os textos de exemplo (nomes, mensagens) são fictícios.

## Identidade

Tema "toca": marrons escuros de terra, laranja como cor principal, mascote toupeira mineradora.
Só tema escuro.

### Cores (tokens)

```css
:root {
  --bg-rail: #16100c; /* barra de título, fundo do login, inputs do login */
  --bg-side: #211813; /* lista de canais, membros */
  --bg-main: #2a201a; /* área do chat, cards */
  --bg-input: #382a21; /* caixa de mensagem, botões secundários */
  --bg-sel: #45342a; /* item selecionado */
  --bg-user: #1b1410; /* painel do usuário (canto inferior esquerdo) */
  --bg-stage: #120d0a; /* fundo da tela de voz */
  --line: #3e2f25;

  --text: #efe3d6;
  --text-head: #fff5ea;
  --text-muted: #b8a693;

  --accent: #f0782a; /* laranja principal */
  --on-accent: #1c120b; /* texto SOBRE o laranja: escuro, nunca branco */
  --speaking: #3fb56b; /* contorno de quem está falando (só isso usa verde) */
  --danger: #d9412f; /* desconectar, selo AO VIVO */
  --link: #f5a26a;
}
```

### Tipografia

- Títulos e o nome "LeTopeiras": **Bricolage Grotesque** 700/800
- Texto: **Figtree** 400–800
- Empacote as fontes localmente no app (não dependa do Google Fonts em runtime).

### Regras

- Botão principal: fundo `--accent`, texto `--on-accent`, peso 800.
- Canal ativo: fundo `--bg-sel` + barrinha laranja de 4px à esquerda.
- Divisor de mensagens novas ("NOVAS"): laranja.
- Verde só para indicar quem está falando; vermelho para AO VIVO e desconectar.
- Cabeçalhos de seção da lista de canais: 11px, peso 800, caixa alta, `letter-spacing: 0.1em`.

## Logo

Em `logo/`:

- `build/icon.ico` → ícone do .exe/instalador (`electron-builder`: `win.icon`)
- `resources/tray.ico` (+ `tray.png`, `tray@2x.png`) → ícone da bandeja e da janela
- `brand/logo.svg` → toupeira sem fundo, para usar dentro da interface (login, topo da lista de canais, barra de título)
- `brand/icon.svg` e `brand/icon-small.svg` → fontes editáveis do ícone (a versão small é a simplificada para 16–32px)
