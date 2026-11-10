# Beacon — Project Instructions

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

`server.js` is a thin CommonJS entry (env → `createApp()` → `listen`). All request
handling lives in `server/app.cjs` so it can be tested with `node --test`. The
Dockerfile copies **both** `server.js` and `server/`; the runtime image has no
`package.json`, which is why the backend must stay CommonJS (`.cjs`).

Commands:

```bash
npm test               # Vitest (frontend)
npm run test:server    # node --test server/__tests__/app.test.cjs (backend)
npm run test:all       # both
npm run test:coverage  # v8 coverage + threshold ratchet (src/api, src/utils)
npm run lint           # ESLint 9 flat config (expect 0 errors)
npm run format         # Prettier write (not a CI gate yet — see docs/engineering-review.md)
```

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
  `BEACON_ALLOWED_ORIGINS`.
- `/beacon-data` writes are atomic (temp file + rename) and every body read is
  bounded by `collectBody`.

See `docs/engineering-review.md` for the full review, findings and open items.

## Learnings - 2026-03-29

### Dual-Directory Structure

**The published image builds from the repo root** (`context: .` in
`.github/workflows/build-addon.yml`); `beacon/` is a legacy mirror that is _not_
used by that build. Keep them aligned anyway — installed add-ons and older docs
may still point at `beacon/`. After ANY source change, sync:

```bash
rsync -av --delete src/ beacon/src/
rsync -av --delete server/ beacon/server/
cp Dockerfile run.sh CHANGELOG.md server.js beacon/
```

Both `config.yaml` and `beacon/config.yaml` must have matching versions.
CI enforces the `src/` half with `scripts/check-beacon-sync.sh`.

**The root-level `Dockerfile` builds from repo-root context (`context: .` in
`.github/workflows/build-addon.yml`), not from `beacon/`.** So anything that
Dockerfile `COPY`s -- including `custom_intents/` and `custom_sentences/` --
must also exist at the repo root, mirrored from `beacon/`, or the Docker
build fails with `"failed to calculate checksum ... not found"`. This bit
us once already: those two dirs existed only under `beacon/` and the image
build silently never ran for months (see the CI/release-trigger bug below),
so nobody caught it until the pipeline was fixed and the build actually
executed. When adding root-level content Dockerfile depends on, sync it
the same way:

```bash
rsync -av --delete beacon/custom_intents/ custom_intents/
rsync -av --delete beacon/custom_sentences/ custom_sentences/
```

### HA Add-on Auth: Long-Lived Token in Config

SUPERVISOR_TOKEN only works container-side (http://supervisor/core). postMessage auth doesn't work in HA companion app WKWebView. The `ha_token` config option (schema: password) with a user-provided long-lived access token is the only reliable browser-side auth approach.

### HA Todo Items: Service Call with ?return_response

Don't read `entity.attributes.items` — it doesn't exist. Use:

```
POST /api/services/todo/get_items?return_response
Body: {"entity_id": "todo.xxx"}
Response: { service_response: { "todo.xxx": { items: [...] } } }
```

Filter out `unavailable` entities during discovery. Calling get_items on unavailable entities returns HTTP 500.

### HA Add-on Store Cache Busting

HA aggressively caches add-on repos. To force update visibility: create a git tag + GitHub release. If that fails, user must remove and re-add the repo URL. The `update_entity` service does NOT trigger a repo refresh.

### Semantic Release

`.releaserc.json` and `.github/workflows/release.yml` handle automated versioning. Uses conventional commits (`fix:` → patch, `feat:` → minor, `BREAKING CHANGE:` → major). Bumps both config.yaml files, syncs changelogs, creates GitHub releases.
