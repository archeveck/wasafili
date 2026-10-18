import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared.ts';

// Critère de fin de P1.2 : couverture de 100 %.
export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      coverage: {
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/test-utils.ts', 'src/index.ts'],
        thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  }),
);
