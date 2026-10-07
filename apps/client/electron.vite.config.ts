import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Workspace packages ship TypeScript source, so they are always bundled.
const bundledWorkspaceDeps = { exclude: ['@letopeiras/shared'] };

export default defineConfig({
  main: {
    build: { externalizeDeps: bundledWorkspaceDeps },
  },
  preload: {
    build: { externalizeDeps: bundledWorkspaceDeps },
  },
  renderer: {
    plugins: [react()],
  },
});
