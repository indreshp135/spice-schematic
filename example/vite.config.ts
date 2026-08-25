import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point at source so the demo hot-reloads on library edits,
      // with no build or npm link step in between.
      'spice-schematic/react': fileURLToPath(new URL('../src/react.tsx', import.meta.url)),
      'spice-schematic': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
});
