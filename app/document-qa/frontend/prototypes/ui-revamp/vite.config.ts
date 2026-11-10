import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/*
 * Standalone UI-revamp prototype. It shares the frontend's installed packages
 * and wire types but none of its routes, providers, or styles, so the
 * production interface is untouched. Loopback only; no remote assets.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));

export default defineConfig({
	root: here,
	publicDir: `${here}public`,
	plugins: [react()],
	resolve: { alias: { $lib: `${sourceRoot}lib` } },
	build: { outDir: `${here}dist`, emptyOutDir: true },
	server: { host: '127.0.0.1', port: 5180, strictPort: true, fs: { allow: [`${here}../..`] } },
	preview: { host: '127.0.0.1', port: 5181, strictPort: true },
});
