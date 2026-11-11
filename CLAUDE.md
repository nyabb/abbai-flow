# Abbai Flow — Project Instructions

## Architecture

- React 19 + TypeScript + Vite SPA (web only — no native shell)
- Home Assistant add-on with ingress support
- Docker for the server; the browser talks to HA directly

## Display Mode (wall touchscreen)

`/display` is a dedicated read-only screen for a permanently running Chromium
kiosk (Raspberry Pi on the wall). Code: `src/components/display/`,
`src/display-route.ts`, `src/hooks/useDisplayMode.ts` (wake lock, fullscreen,
idle timeout), `src/hooks/useConnectionStatus.ts`, `src/styles/display.css`.
Full documentation, kiosk launch line and connection states: see
`docs/display-mode.md`.

## Backend layout (since 2026-11-09)

`server/main.cjs` is the real entry (env → `createApp()` → `listen`); the
root `server.js` is a one-line CommonJS shim so the image's
`CMD ["node", "server.js"]` keeps working. All request handling lives in
`server/app.cjs` so it can be tested with `node --test`. `npm start` runs
`server/main.cjs` locally — a root `.js` file cannot be CommonJS here because
`package.json` declares `"type": "module"` for the frontend.

Commands:

```bash
npm test               # Vitest (frontend)
npm run test:server    # node --test server/__tests__/app.test.cjs (backend)
npm run test:all       # both
npm run test:coverage  # v8 coverage + threshold ratchet (src/api, src/utils)
npm run lint           # ESLint 9 flat config (expect 0 errors)
npm run typecheck      # tsc (src) + tsc -p tsconfig.scripts.json
npm run build:server   # compile src/api/planner-rules.ts -> server/build/ (CommonJS)
npm start              # run the backend locally (needs build:server first)
npm run format         # Prettier write (not a CI gate yet — see docs/engineering-review.md)
```

Planner rules are **one TypeScript file** (`src/api/planner-rules.ts`): the
browser imports it, and `tsconfig.server.json` compiles it to
`server/build/planner-rules.js` for the CommonJS server (gitignored; produced by
`npm run build`, `npm run build:server`, and automatically by `pretest:server`).
`server/package.json` declares `"type": "commonjs"` so that artefact loads as
CommonJS even though the repo root is `"type": "module"`.

There are **no `.mjs` files**: scripts are TypeScript and run with
`node --experimental-strip-types` (Node 22.6+).

Dependency note: `@testing-library/dom` is a **peer** dependency of
`@testing-library/react` and is listed explicitly on purpose. Without it, an install that
resolves peers differently (e.g. `npm i --legacy-peer-deps`) drops it, every test file
fails to collect, and the suite reports "no tests" instead of failing loudly.

Backend rules that are easy to break:

- Proxy/HA transports must follow the configured protocol (`transportFor` /
  `defaultPortFor`) — do not hard-code `http`/port 80, HA may be HTTPS.
- `resolveHaUrl()` resolves the request path relatively so the Supervisor base
  `http://supervisor/core` keeps its `/core` prefix.
- Every mutating endpoint passes `isAllowedOrigin()` (CSRF guard); native shells
  (`capacitor://localhost`) are allowed explicitly, extra hosts via
  `ABBAI_FLOW_ALLOWED_ORIGINS`.
- `/beacon-data` writes are atomic (temp file + rename) and every body read is
  bounded by `collectBody`.

See `docs/engineering-review.md` for the full review, findings and open items.

## Learnings

### Deployment configuration (container)

The image reads `HA_URL` + `HA_TOKEN` — a long-lived access token, created in
Home Assistant under *Profile → Security*. That is the whole contract; everything
else has a working default.

Paths, the CSRF allow-list and a private CA use `ABBAI_FLOW_*` names
(`ABBAI_FLOW_DATA`, `ABBAI_FLOW_DIST`, `ABBAI_FLOW_ALLOWED_ORIGINS`,
`ABBAI_FLOW_HA_CA`, `ABBAI_FLOW_PORT`). **Renamed in 2.0.0** — the old
`BEACON_*` spellings are not read any more, and `docs/upgrade-2.0.0.md` has the
mapping. Do not add silent fallbacks for them: a stale data path would split a
household's documents across two directories.

`server/app.cjs` serves `/runtime-config.js`, which sets
`window.__ABBAI_FLOW_CONFIG__` from those env vars. That file is what tells the
SPA it sits behind the proxy (so it stops asking for a token) — it must never
contain the token itself. `index.html` loads it before the bundle; the copy in
`public/` is an empty stub for `npm run dev`.

### HA Todo Items: Service Call with `?return_response`

Don't read `entity.attributes.items` — it doesn't exist. Use:

```
POST /api/services/todo/get_items?return_response
Body: {"entity_id": "todo.xxx"}
Response: { service_response: { "todo.xxx": { items: [...] } } }
```

Filter out `unavailable` entities during discovery. Calling get_items on unavailable entities returns HTTP 500.

### Semantic Release

`.releaserc.json` and `.github/workflows/release.yml` handle automated versioning. Uses conventional commits (`fix:` → patch, `feat:` → minor, `BREAKING CHANGE:` → major). The release job calls the image workflow directly, because GitHub does not fire tag-triggered workflows for `GITHUB_TOKEN`-authored activity.
