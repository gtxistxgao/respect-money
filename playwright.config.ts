import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3101', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'production', testIgnore: '**/development.spec.ts' },
    { name: 'development', testMatch: '**/development.spec.ts', use: { baseURL: 'http://127.0.0.1:5174' } },
  ],
  webServer: [
    { command: 'tsx scripts/e2e-server.ts', url: 'http://127.0.0.1:3101/api/health', reuseExistingServer: !process.env.CI },
    { command: 'vite --config vite.e2e.config.ts --host 127.0.0.1 --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
  ],
});
