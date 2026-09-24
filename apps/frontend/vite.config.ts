/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The release tag, passed as APP_VERSION at image build time; "dev" otherwise.
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev') },
  plugins: [react(), tailwindcss()],
  // jSquash loads its WASM relative to its own module: pre-bundling would lose the file.
  optimizeDeps: { exclude: ['@jsquash/webp'] },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    // WSL2/Docker : les events inotify ne traversent pas le bind mount → le watcher
    // natif rate les modifs et Vite sert des transforms en cache obsolètes. Polling
    // pour forcer la détection (cf. même piège que tsc côté backend).
    watch: { usePolling: true, interval: 200 },
    proxy: {
      // Le builder (REST) et la doc API passent par le backend.
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
      // Temps réel : Socket.IO (handshake + upgrade WebSocket) vers le backend.
      '/socket.io': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
