import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    // Ant Design v6 plus the chart runtime is a large single payload at this
    // stage; feature-level code splitting lands with the Phase 5 shell.
    chunkSizeWarningLimit: 1200,
  },
});
