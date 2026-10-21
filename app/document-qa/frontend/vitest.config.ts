import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
 server: { hmr: false, ws: false },
 test: {
  environment: 'jsdom',
  include: ['../src/lib/features/**/*.test.{js,ts,tsx}', '../src/react/**/*.test.{ts,tsx}'],
  exclude: ['../src/lib/features/**/*.integration.test.ts']
 }
}));
