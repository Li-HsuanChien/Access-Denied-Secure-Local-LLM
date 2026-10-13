import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
	resolve: { conditions: ['browser'] },
	test: { environment: 'jsdom', include: ['src/lib/features/**/*.test.{js,ts}'], exclude: ['src/lib/features/**/*.integration.test.ts'] }
}));
