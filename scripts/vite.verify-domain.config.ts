import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * SSR bundle of `scripts/verify-domain.ts` so the domain suite can execute in
 * plain Node. Output lands in the gitignored `.verify-cache` directory.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    ssr: true,
    outDir: '.verify-cache',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        'verify-domain': 'scripts/verify-domain.ts',
        'verify-storage': 'scripts/verify-storage.ts',
        'verify-components': 'scripts/verify-components.tsx',
        'verify-hooks': 'scripts/verify-hooks.ts',
      },
      output: {
        entryFileNames: '[name].mjs',
        format: 'esm',
      },
    },
  },
  ssr: {
    target: 'node',
    noExternal: true,
  },
  logLevel: 'warn',
});
