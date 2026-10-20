import { defineConfig, devices } from '@playwright/test';

/**
 * Parcours critiques du back-office (P2.3.6). L'API locale (port 3000) et la base de dev
 * doivent être prêtes : `pnpm infra:up && pnpm db:migrate && pnpm db:seed`.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env['CI'] ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'fr-FR',
    timezoneId: 'Africa/Abidjan',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @wasafili/api build && pnpm --filter @wasafili/api start',
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
      timeout: 180_000,
      cwd: '../..',
    },
    {
      command: 'pnpm exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    },
  ],
});
