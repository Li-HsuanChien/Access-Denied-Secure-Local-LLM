import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
 server: { hmr: false, ws: false },
 // Every suite must explicitly opt in to the disposable endpoint; no user host default.
 test: { environment: 'node', include: ['../src/lib/features/**/*.integration.test.ts'], testTimeout: 30_000 }
}));
