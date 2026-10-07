import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';

// Workspace packages ship TypeScript source, so they are always bundled.
const bundledWorkspaceDeps = { exclude: ['@letopeiras/shared'] };

const DEFAULT_SERVER_URL = 'https://letopeiras.duckdns.org';
const DEFAULT_LIVEKIT_URL = 'wss://letopeiras-lk.duckdns.org';

/** The origin of `url` in both its HTTP and WebSocket flavors. */
function originPair(url: string): string[] {
  const { protocol, host } = new URL(url);
  const secure = protocol === 'https:' || protocol === 'wss:';
  return [`${secure ? 'https' : 'http'}://${host}`, `${secure ? 'wss' : 'ws'}://${host}`];
}

/**
 * Fills the CSP's connect-src with the hosts the renderer actually talks to: our server
 * (REST + WebSocket) and LiveKit (signaling). Dev also allows the local server, LiveKit and
 * Vite's HMR socket.
 */
function connectSrc(mode: string, isDev: boolean): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const serverUrl =
    env['VITE_SERVER_URL'] ?? (isDev ? 'http://127.0.0.1:3000' : DEFAULT_SERVER_URL);
  const livekitUrl = env['VITE_LIVEKIT_URL'] ?? DEFAULT_LIVEKIT_URL;
  const sources = new Set(["'self'", ...originPair(serverUrl), ...originPair(livekitUrl)]);
  if (isDev) {
    for (const host of ['localhost:*', '127.0.0.1:*']) {
      sources.add(`http://${host}`);
      sources.add(`ws://${host}`);
    }
  }
  return {
    name: 'letopeiras-csp-connect-src',
    transformIndexHtml: (html) => html.replace('%CONNECT_SRC%', [...sources].join(' ')),
  };
}

export default defineConfig(({ mode, command }) => ({
  main: {
    build: { externalizeDeps: bundledWorkspaceDeps },
  },
  preload: {
    build: { externalizeDeps: bundledWorkspaceDeps },
  },
  renderer: {
    plugins: [react(), connectSrc(mode, command === 'serve')],
  },
}));
