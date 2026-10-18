import { defineConfig } from 'vitest/config';

/** Preset Vitest partagé par les paquets et applications du monorepo. */
export const sharedTestConfig = defineConfig({
  test: {
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
