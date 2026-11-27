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
  // Runtime integration settings are managed by the app server.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/abbai-flow/photos': {
          target: env.VITE_ABBAI_FLOW_BACKEND_URL?.trim() || 'http://localhost:3001',
          changeOrigin: false,
        },
        '/abbai-flow/music': {
          target: env.VITE_ABBAI_FLOW_BACKEND_URL?.trim() || 'http://localhost:3001',
          changeOrigin: false,
        },
      },
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
