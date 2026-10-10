import { defineConfig } from 'vitest/config';

// Unit tests for the renderer's pure modules (no Electron, no DOM).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { include: ['src/**/*.test.{ts,tsx}'] },
});
