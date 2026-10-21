import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const sourceRoot = fileURLToPath(new URL('./src/', import.meta.url));
export default defineConfig({
 root: 'react',
 publicDir: '../static',
 plugins: [react()],
 resolve: { alias: { '$lib': `${sourceRoot}lib`, '@': sourceRoot } },
 build: {
  outDir: '../build', emptyOutDir: true,
  // Retain decimal shadow alpha and OKLCH precision proven in parity captures.
  cssMinify: false,
  sourcemap: true
 },
 server: { host: '127.0.0.1', port: 5173, strictPort: true },
 preview: { host: '127.0.0.1' }
});
