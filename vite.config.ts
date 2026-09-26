import { defineConfig } from 'vite';
import { readConfig } from './src/server/config.js';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(() => ({
  root: 'src/web',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Keep frontend modules such as /api.ts outside the backend proxy.
    proxy: { '/api/': `http://127.0.0.1:${readConfig().port}` },
    fs: { allow: [resolve('src'), resolve('node_modules')] },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
}));
