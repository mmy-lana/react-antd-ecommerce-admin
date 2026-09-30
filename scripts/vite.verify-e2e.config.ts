import { defineConfig } from 'vite';

/**
 * SSR bundle of `scripts/verify-e2e.ts` so the browser suite can execute in
 * plain Node.
 *
 * Deliberately a separate config from `vite.verify-domain.config.ts`: that one
 * sets `noExternal: true` and would try to inline Vite's own server and the
 * Playwright driver into the bundle. Here the tooling stays external and is
 * resolved from `node_modules` at run time.
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: '.verify-cache-e2e',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { 'verify-e2e': 'scripts/verify-e2e.ts' },
      output: {
        entryFileNames: '[name].mjs',
        format: 'esm',
      },
    },
  },
  ssr: {
    target: 'node',
  },
  logLevel: 'warn',
});