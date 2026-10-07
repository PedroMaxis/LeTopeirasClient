import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/create-admin.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  // Workspace packages ship TypeScript source, so they must be bundled in.
  deps: { alwaysBundle: [/^@letopeiras\//] },
});
