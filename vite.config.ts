import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

// package.json is the version source for builds and releases. A deployment can
// override it with VITE_APP_VERSION without needing a release plugin locally.
function getAppVersion(override: string | undefined): string {
  const supplied = override?.trim();
  if (supplied) return supplied;

  try {
    const packageJson = JSON.parse(
      readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
    ) as { version?: unknown };
    if (typeof packageJson.version === 'string' && packageJson.version.trim()) {
      return packageJson.version.trim();
    }
  } catch {
    // A development build should still identify itself if package metadata is unavailable.
  }
  return 'dev';
}

export default defineConfig(({ mode }) => {
  // Dev-only stand-in for the add-on's server proxy: forward /api to HA so REST
  // calls stay same-origin and CORS never comes into play. Mirrors the
  // condition in src/api/ha-rest.ts's resolveBaseUrl().
  const env = loadEnv(mode, process.cwd(), '');
  const haUrl = env.VITE_HA_URL?.trim();

  return {
    plugins: [react()],
    server: {
      port: 3000,
      host: true,
      proxy: haUrl
        ? {
            '/api': {
              target: haUrl.replace(/\/$/, ''),
              changeOrigin: true,
              secure: false,
              ws: true,
            },
          }
        : undefined,
    },
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(
        getAppVersion(process.env.VITE_APP_VERSION?.trim() || env.VITE_APP_VERSION),
      ),
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
