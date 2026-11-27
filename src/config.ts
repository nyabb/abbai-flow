/**
 * Abbai Flow runtime configuration.
 *
 * A deployment that runs Abbai Flow's own server serves `/runtime-config.js`,
 * which defines window.__ABBAI_FLOW_CONFIG__ (see server/app.cjs). During local
 * development values can fall back to VITE_* variables.
 */

export interface AbbaiConfig {
  family_name: string;
  save_config_in_browser: boolean;
  theme: string;
  auto_dark_mode: boolean;
  photo_interval: number;
  screen_saver_timeout: number;
}

declare global {
  interface Window {
    __ABBAI_FLOW_CONFIG__?: Partial<AbbaiConfig>;
  }
}

/**
 * The runtime configuration injected by the deployment, if any.
 *
 * Returns `undefined` for a plain static build (no app server).
 */
export function getRuntimeConfig(): Partial<AbbaiConfig> | undefined {
  return window.__ABBAI_FLOW_CONFIG__;
}

let cached: AbbaiConfig | null = null;

export function getConfig(): AbbaiConfig {
  if (cached) return cached;

  const runtime = getRuntimeConfig() ?? {};

  cached = {
    family_name: runtime.family_name || import.meta.env.VITE_FAMILY_NAME || 'My Family',
    save_config_in_browser:
      runtime.save_config_in_browser ?? import.meta.env.VITE_SAVE_CONFIG_IN_BROWSER !== 'false',
    theme: runtime.theme || import.meta.env.VITE_THEME || 'skylight',
    auto_dark_mode: runtime.auto_dark_mode ?? import.meta.env.VITE_AUTO_DARK_MODE !== 'false',
    photo_interval: runtime.photo_interval ?? (Number(import.meta.env.VITE_PHOTO_INTERVAL) || 30),
    screen_saver_timeout:
      runtime.screen_saver_timeout ?? (Number(import.meta.env.VITE_SCREEN_SAVER_TIMEOUT) || 5),
  };

  return cached;
}

/**
 * Override cached deployment values without requiring a page reload.
 */
export function patchConfig(patch: Partial<AbbaiConfig>): void {
  const current = getConfig();
  cached = { ...current, ...patch };
}
