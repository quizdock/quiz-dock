/// <reference types="vitest/config" />
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The icon (tab, home screen): the operator's in branding/, QuizDock's otherwise — as nginx does. */
const ICONS = new Set(['/favicon.png']);

export default defineConfig({
  // The release tag, passed as APP_VERSION at image build time; "dev" otherwise.
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev') },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'branding-icons',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url && ICONS.has(req.url)) {
            const own = existsSync(
              fileURLToPath(new URL(`./public/branding${req.url}`, import.meta.url)),
            );
            req.url = own ? `/branding${req.url}` : '/icons/quizdock.png';
          }
          next();
        });
      },
    },
  ],
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
    // The Host is kept (no `changeOrigin`): the backend compares it with the
    // Origin of what changes something, the way it will see them in production.
    proxy: {
      // Le builder (REST) et la doc API passent par le backend.
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
      },
      // The runtime configuration (name, language, logo…): the backend's, as in production.
      '/config.js': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
      },
      // The instance's palette (lot 5 of the administration): the backend's too.
      '/branding/theme.css': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
      },
      // Temps réel : Socket.IO (handshake + upgrade WebSocket) vers le backend.
      '/socket.io': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Whole pages (the editor) take ~0.4 s alone, but more than 5 s when the pre-push
    // hook runs the backend's suite alongside: a slow machine is not a failing test.
    testTimeout: 15_000,
    // From Node 25 on, Node has a `localStorage` of its own, which shadows jsdom's:
    // a test would write to one while the code reads the other. jsdom's, always.
    poolOptions: { forks: { execArgv: ['--no-experimental-webstorage'] } },
  },
});
