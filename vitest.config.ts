import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx', 'src/test/**', 'src/styles/themes/*.ts'],
      // Thresholds are set from measured values (see docs/engineering-review.md)
      // as a ratchet: they must not go down, and should be raised as coverage
      // grows. Only the modules with real enforcement today are listed — the
      // presentational components are tracked but not yet gated.
      thresholds: {
        'src/api/**': { statements: 50, branches: 50, functions: 42, lines: 51 },
        'src/utils/**': { statements: 72, branches: 64, functions: 67, lines: 70 },
      },
    },
  },
});
