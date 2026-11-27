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
      // Thresholds are a ratchet: they must not go down, and should be raised as coverage
      // grows. Only the modules with real enforcement today are listed — the
      // presentational components are tracked but not yet gated.
      thresholds: {
        'src/api/**': { statements: 50, branches: 50, functions: 42, lines: 51 },
        'src/utils/**': { statements: 72, branches: 64, functions: 67, lines: 70 },
        // Keep the family-routine scheduling and editor paths above 70% while
        // the repository-wide baseline is raised independently.
        'src/api/routine-schedule.ts': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        'src/components/settings/sections/family/RoutineEditor.tsx': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        'src/components/routines/RoutineActionsMenu.tsx': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        'src/components/routines/RoutineEditorDialog.tsx': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        'src/components/focus/RoutineCard.tsx': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        'src/components/settings/sections/FamilySection.tsx': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        'src/hooks/useRoutines.ts': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        'src/components/chore-planner/ChorePlanner.tsx': {
          statements: 70,
          functions: 70,
          lines: 70,
        },
        'src/components/chore-planner/ChoreBoard.tsx': {
          statements: 70,
          branches: 70,
          lines: 70,
        },
      },
    },
  },
});
