import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      environmentMatchGlobs: [['server/**', 'node']],
      setupFiles: ['./test/setup.ts'],
      include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}', 'server/**/*.{test,spec}.{js,jsx,ts,tsx}'],
      exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.md.jsx'],
    },
  }),
);
