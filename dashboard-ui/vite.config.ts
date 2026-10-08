import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

/** Serve shared/normalize.js during `vite dev` so globalThis.BBX exists. */
function serveNormalize() {
  const file = path.join(root, 'shared', 'normalize.js');
  const send = (_req: unknown, res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }) => {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(fs.readFileSync(file, 'utf8'));
  };
  return {
    name: 'serve-normalize',
    configureServer(server: { middlewares: { use: (p: string, fn: typeof send) => void } }) {
      server.middlewares.use('/shared/normalize.js', send);
    },
  };
}

export default defineConfig({
  plugins: [react(), serveNormalize()],
  base: './',
  server: { fs: { allow: [root] } },
  build: {
    outDir: path.join(root, 'dashboard'),
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/dashboard.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/dashboard[extname]',
      },
    },
  },
});
