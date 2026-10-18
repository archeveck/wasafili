import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared.ts';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    test: { environment: 'jsdom', exclude: ['e2e/**', 'node_modules/**'] },
  }),
);
