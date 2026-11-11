/**
 * Abbai Flow runtime configuration.
 *
 * A deployment that runs Abbai Flow's own server serves `/runtime-config.js`,
 * which defines window.__ABBAI_FLOW_CONFIG__ (see server/app.cjs). During local
 * development the values fall back to VITE_* environment variables.
 */

export interface AbbaiConfig {
  deployment_mode?: 'addon' | 'standalone';
  ha_url: string;
  ha_token: string;
  family_name: string;
  save_config_in_browser: boolean;
  theme: string;
  auto_dark_mode: boolean;
  weather_entity: string;
  photo_directory: string;
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
 * Returns `undefined` for a plain static build (no server), which is what puts
 * the app into direct-HA mode with browser-side onboarding.
 */
export function getRuntimeConfig(): Partial<AbbaiConfig> | undefined {
  return window.__ABBAI_FLOW_CONFIG__;
}

let cached: AbbaiConfig | null = null;

export function getConfig(): AbbaiConfig {
  if (cached?.ha_token && cached?.ha_url) return cached;

  const runtime = getRuntimeConfig() ?? {};

  cached = {
    ha_url: runtime.ha_url ?? import.meta.env.VITE_HA_URL ?? '',
    ha_token: runtime.ha_token || import.meta.env.VITE_HA_TOKEN || '',
    family_name: runtime.family_name || import.meta.env.VITE_FAMILY_NAME || 'My Family',
    save_config_in_browser:
      runtime.save_config_in_browser ?? import.meta.env.VITE_SAVE_CONFIG_IN_BROWSER !== 'false',
    theme: runtime.theme || import.meta.env.VITE_THEME || 'skylight',
    auto_dark_mode: runtime.auto_dark_mode ?? import.meta.env.VITE_AUTO_DARK_MODE !== 'false',
    weather_entity:
      runtime.weather_entity || import.meta.env.VITE_HA_WEATHER_ENTITY || 'weather.home',
    photo_directory:
      runtime.photo_directory || import.meta.env.VITE_PHOTO_DIRECTORY || '/media/beacon/photos',
    photo_interval: runtime.photo_interval ?? (Number(import.meta.env.VITE_PHOTO_INTERVAL) || 30),
    screen_saver_timeout:
      runtime.screen_saver_timeout ?? (Number(import.meta.env.VITE_SCREEN_SAVER_TIMEOUT) || 5),
  };

  return cached;
}

/**
 * Override the cached config with dynamic credentials (from onboarding/OAuth).
 * Call this after the user completes setup to inject the HA URL + token
 * without requiring a page reload.
 */
export function patchConfig(patch: Partial<AbbaiConfig>): void {
  const current = getConfig();
  cached = { ...current, ...patch };
}
