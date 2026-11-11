/*
 * Development stub for the runtime configuration.
 *
 * `server/app.cjs` serves this path dynamically in the container image, where
 * it emits `window.__ABBAI_FLOW_CONFIG__` built from `HA_URL` / `HA_TOKEN`. This
 * file only exists so `npm run dev` (and any static hosting of `dist/` without
 * the backend) gets a clean 200 instead of a 404 in the console — the app then
 * falls back to its normal onboarding flow.
 *
 * Do not add configuration here: anything committed would be baked into every
 * build, and the HA token must never leave the server.
 */
