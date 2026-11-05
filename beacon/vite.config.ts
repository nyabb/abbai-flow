import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// Read the authoritative add-on version from config.yaml at the repo root
// (kept in sync with beacon/config.yaml by the semantic-release pipeline —
// see .releaserc.json's @semantic-release/exec prepareCmd). package.json's
// "version" field is NOT the source of truth for this add-on; don't read it.
function getAppVersion(): string {
  try {
    const configPath = fileURLToPath(new URL('./config.yaml', import.meta.url));
    const configYaml = readFileSync(configPath, 'utf-8');
    const match = configYaml.match(/^version:\s*["']?([^"'\n]+)["']?\s*$/m);
    if (match) return match[1].trim();
  } catch {
    // fall through to default below
  }
  return '0.0.0';
}

export default defineConfig(({ mode }) => {
  // Dev-only stand-in for the add-on's server proxy: forward /api to HA so REST
  // calls stay same-origin and CORS never comes into play. Mirrors the
  // condition in src/api/ha-rest.ts's resolveBaseUrl().
  const haUrl = loadEnv(mode, process.cwd(), '').VITE_HA_URL?.trim();

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
      __APP_VERSION__: JSON.stringify(getAppVersion()),
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
