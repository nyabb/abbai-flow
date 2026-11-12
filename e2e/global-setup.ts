import { execFileSync } from 'node:child_process';

/**
 * Build everything the E2E stack serves: the SPA (`vite build`), the TypeScript
 * sources, and the CommonJS planner rules the server reduces operations with.
 *
 * A stale `dist/` would make the browser test an older app than the one in the
 * working tree, so the build runs by default; `E2E_SKIP_BUILD=1` is the
 * deliberate opt-out for quick local loops.
 */
export default function globalSetup(): void {
  if (process.env.E2E_SKIP_BUILD === '1') return;
  execFileSync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
}
