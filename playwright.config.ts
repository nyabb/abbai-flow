import { defineConfig } from '@playwright/test';

/**
 * Browser E2E suite.
 *
 * These tests boot the real backend (`server/app.cjs`) against a fake Home
 * Assistant, so they exercise the SPA, the `/beacon-data` store, the planner
 * mutation endpoint and the ChoreOps service bridge together — not a mocked
 * React tree.
 *
 * Run with `npm run test:e2e`. `globalSetup` builds the SPA and the CommonJS
 * planner rules first; set `E2E_SKIP_BUILD=1` to reuse an existing `dist/`.
 *
 * The default browser is the locally installed Google Chrome (`channel:
 * 'chrome'`) because Playwright's bundled Chromium is not available on every
 * host (e.g. macOS 13). In CI, install the bundled browser and set
 * `PLAYWRIGHT_CHANNEL=chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  use: {
    channel: (process.env.PLAYWRIGHT_CHANNEL as 'chrome' | 'chromium' | undefined) ?? 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
