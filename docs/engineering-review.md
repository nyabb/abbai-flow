# Beacon — Engineering review

Date: 2026-11-09
Scope: architecture, reliability, security, performance, tests, developer experience.

This document records what was **investigated**, what was **changed and verified**, and
what is **still open**. Everything marked "verified" was executed on the machine where
this review was written; nothing here is a projected result.

---

## A. Architecture overview

### Runtime shapes

| Mode                    | Entry                  | Who talks to Home Assistant                                             |
| ----------------------- | ---------------------- | ----------------------------------------------------------------------- |
| Dev (`npm run dev`)     | Vite (port 3001)       | Browser directly; Vite proxies `/api` to `VITE_HA_URL`                  |
| Add-on (Supervisor)     | `run.sh` → `server.js` | Server-side proxy with `SUPERVISOR_TOKEN`; browser uses HA ingress path |
| Standalone Docker       | `run.sh` → `server.js` | Server-side proxy with `HA_TOKEN` + `HA_API_BASE_OVERRIDE`              |
| Capacitor (iOS/Android) | `dist/` in WebView     | Browser directly with a user supplied long-lived token                  |

### Backend (`server.js` + `server/app.cjs`)

```
server.js            thin entry: env → createApp() → listen, graceful shutdown
server/app.cjs       request routing + handlers (CommonJS, testable)
  ├─ serveStatic()               SPA from BEACON_DIST, traversal-guarded
  ├─ proxyToHA()                 /api/* → HA REST (server token)
  ├─ handleUpgrade()             /api/websocket → HA WS (ws/wss aware)
  ├─ handleServiceCall()         /beacon-action/service
  ├─ handleCalendarEventAction() /beacon-action/calendar-event (WS-only HA commands)
  ├─ handleDataApi()             /beacon-data/:key (atomic JSON persistence)
  └─ handleVoiceAction()         /beacon-action/voice (keyword intents)
```

`server/app.cjs` exports `createApp`, `configFromEnv` and the individual helpers, so
behaviour can be asserted with `node --test` instead of by hand.

### Frontend

- `src/App.tsx` — shell, navigation, screens.
- Domain/API modules: `src/api/*` (`homeassistant`, `ha-rest`, `choreops`,
  `chore-planner-*`, `beacon-store`).
- Hooks: `useHomeAssistant`, `useChoreOps`, `useCalendarEvents`, `useFamily`,
  `useSettings`, `useLocalCalendar`, `useLocalTasks`, `useDashboardLayout`.
- Components: `components/**` (cards, `ChorePlanner`, `SettingsView`, …).
- Persistence: `beacon-store` (server + localStorage cache), `family.ts` stores.

### Data flow (add-on)

```
UI hook → ha-rest / HomeAssistantClient → server.js (/api or /beacon-action/*)
        → Home Assistant (REST or WS) → normaliser → React state
Persistence: UI → saveData() → PUT /beacon-data/:key → /data/<key>.json (atomic)
             (localStorage stays a read-through cache)
```

### Build & deploy

- `npm run build` = `tsc && vite build` → `dist/`.
- `Dockerfile` (repo root, `context: .` in `build-addon.yml`) builds the image; the
  runtime stage copies `dist`, `node_modules/ws`, `run.sh`, `server.js`, `server/`, and
  the custom intents/sentences.
- `beacon/` is a legacy mirror of the repo. **The published image does not use it**;
  CI keeps `beacon/src` aligned with `src` via `scripts/check-beacon-sync.sh`.

---

## B. Code quality report (findings)

Severity is about impact on users of the shipped add-on image.

| #   | Sev      | Where                                 | Problem                                                                                                                                             | Status                                        |
| --- | -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Critical | `server.js` upgrade handler           | Transport hard-coded to `http` with port `80`; an `https://` HA URL could never upgrade. Also forwarded browser cookies and had no timeout/cleanup. | Fixed                                         |
| 2   | Critical | `haRequest()` (voice, service bridge) | Same hard-coded `http`/`80`, so HTTPS Home Assistant installs broke on `/beacon-action/service` and `/beacon-action/voice`.                         | Fixed                                         |
| 3   | High     | `proxyToHA()`                         | Body buffered without a limit, no upstream timeout, could answer twice after a client abort.                                                        | Fixed                                         |
| 4   | High     | `handleVoiceAction()`                 | Read the raw body with no size limit (`chunks` unbounded) — trivial memory exhaustion.                                                              | Fixed                                         |
| 5   | High     | `/beacon-data` PUT                    | `writeFile` in place: a crash mid-write left truncated JSON that then read back as corrupt.                                                         | Fixed (temp file + rename)                    |
| 6   | High     | `/beacon-data` GET                    | Malformed stored JSON surfaced as a raw error message / inconsistent status.                                                                        | Fixed (typed `CORRUPT_STORE`, stable message) |
| 7   | High     | All token-bearing endpoints           | No origin check: any web page opened on the wall display could drive `/beacon-action/*` and `/api/*` against HA.                                    | Fixed (same-origin/native-shell guard)        |
| 8   | Medium   | `/beacon-action/service`              | `domain`/`service` were interpolated into an HA path unvalidated (`../` traversal into other HA endpoints).                                         | Fixed                                         |
| 9   | Medium   | `server.js` structure                 | 829-line monolith that started listening on `require`, so no automated test could exercise it.                                                      | Fixed (entry + `server/app.cjs`)              |
| 10  | Medium   | `src/api/beacon-store.ts`             | PUT resolved regardless of `res.ok`, so a rejected write looked successful.                                                                         | Fixed (typed result + error)                  |
| 11  | Medium   | `src/api/beacon-store.ts`             | Two saves of one key raced; the slower one landed last on the server.                                                                               | Fixed (per-key write queue)                   |
| 12  | Medium   | `src/hooks/useCalendarEvents.ts`      | Calendars fetched one-by-one; a slow earlier response could overwrite a newer range; no cancellation.                                               | Fixed                                         |
| 13  | Low      | `src/hooks/useChoreOps.ts`            | REST fallback polled every 30 s even while the tab was hidden.                                                                                      | Fixed                                         |
| 14  | Low      | `beacon/` mirror                      | Duplicated tree; `beacon/package.json` had drifted (no test tooling). Not used by the published image.                                              | Documented (kept for compatibility)           |
| 15  | Low      | Toolchain                             | No linter, no formatter check, no E2E harness, no coverage gate.                                                                                    | Open — see H                                  |

Oversized modules (unchanged in this pass, see H for the plan):

| File                              | Lines |
| --------------------------------- | ----- |
| `src/components/ChorePlanner.tsx` | 2481  |
| `src/components/SettingsView.tsx` | 2072  |
| `src/api/choreops.ts`             | 887   |
| `src/App.tsx`                     | 826   |

---

## C. Implementation (this pass)

### C1. Backend split for testability

- `server/app.cjs` — routing, handlers, HA clients (CommonJS so the image can `require`
  it without a `package.json`, and so `node --test` can load it from this repo).
- `server.js` — ~40 lines: env → `createApp()` → `listen`, plus SIGTERM/SIGINT drain.
- `Dockerfile` (root and mirror) now also copies `server/`.

### C2. Protocol-aware proxying (issue 1, 2)

`transportFor(protocol)` / `defaultPortFor(protocol)` drive every hop:

- REST proxy, service bridge, voice endpoint and the WebSocket upgrade all follow the
  configured base URL (`https://` → `https`/443 for REST, TLS for the WS handshake).
- `resolveHaUrl()` joins base + path **relatively**, so the Supervisor base
  `http://supervisor/core` keeps its `/core` prefix.
- The upgrade handler forwards only the WebSocket handshake headers (never cookies or
  the browser's `Authorization`), applies an upgrade timeout, and tears down both
  sockets on any failure so no socket leaks.

### C3. Request handling (issues 3, 4)

- One bounded body reader (`collectBody`) with a 1 MiB cap, abort/timeout handling, and a
  single-settlement contract — a handler can only answer once.
- All JSON bodies go through `readJsonObject` (malformed JSON → 400, non-object → 400,
  oversized → 413).
- `proxyToHA` streams the response straight through, applies a 30 s upstream timeout, and
  aborts the upstream request when the client disconnects.

### C4. Persistence (issues 5, 6, 10, 11)

- Atomic writes: `writeFile` to a uniquely named temp file in the target directory, then
  `rename`. A crash leaves the previous document intact.
- Reads validate JSON; a corrupt document returns `500 {"error":"Stored document is corrupt"}`
  and logs the file name server-side instead of leaking parser details.
- `GET /beacon-data/:key` sends `Cache-Control: no-store`.
- Server errors no longer echo `err.message` (no filesystem paths in responses).
- Client: `saveData()` validates `res.ok`, returns
  `{ cached, persisted, error?: PersistenceError }`, and serialises writes per key.

### C5. Security model (issues 7, 8)

- Mutating requests (`POST/PUT/…` on `/beacon-action/*`, `/beacon-data/*` and the
  `/api/*` proxy) must pass `isAllowedOrigin()`:
  - no `Origin` header → allowed (same-origin fetch, HA ingress, native shells),
  - `Origin` host must equal `Host` / `X-Forwarded-Host`,
  - `capacitor://localhost`, `ionic://localhost`, `http(s)://localhost` are allowed for
    the native builds,
  - extra origins can be added with `BEACON_ALLOWED_ORIGINS=origin1,origin2`.
- HA identifiers are validated (`/^[a-z_][a-z0-9_]*$/i`, max 64) before being spliced
  into a proxied path.
- JSON content type required on the JSON bridges (415 otherwise).
- **Trust boundaries**
  - _Add-on_: the only ingress is HA's authenticated ingress proxy; the container port is
    not published. The token never leaves the server.
  - _Standalone Docker_: port 3000 is directly reachable. Anything that can reach it can
    use the server-side HA token; put it behind a reverse proxy or a firewall rule, or set
    `BEACON_ALLOWED_ORIGINS` when fronting it with another host name. This is unchanged
    behaviour, now documented rather than implied.
  - _Capacitor_: the app talks to HA directly with a user-provided token; no server hop.

### C6. Performance (issue 12, 13)

- `mapWithConcurrency` (`src/utils/bounded-map.ts`): order-preserving, bounded fan-out,
  per-item failure isolation.
- Calendar events: all calendars fetched with at most **6** concurrent requests, results
  merged and sorted by start; the previous fan-out is aborted when a new range arrives and
  a stale response is dropped by request id; a per-calendar failure keeps the other
  calendars' events.
- `useChoreOps` REST polling skips ticks while `document.hidden` and refreshes immediately
  on `visibilitychange`.

---

## D. Test report

Executed on 2026-11-09:

| Suite                     | Command                                    | Result                                                                                 |
| ------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Frontend (Vitest, jsdom)  | `npm test`                                 | **254 passed / 33 files**                                                              |
| Backend (`node --test`)   | `npm run test:server`                      | **15 passed / 15**                                                                     |
| Type check                | `npx tsc --noEmit`                         | clean                                                                                  |
| Production build          | `npm run build`                            | success (`dist/`)                                                                      |
| Runtime layout smoke test | `node server.js` in a container-shaped dir | `GET /` 200, `GET /beacon-data/x` → `null`, `PUT` 200, `GET` → `{"v":1}`, file on disk |

New tests added:

- `server/__tests__/app.test.cjs` (15): URL/transport helpers, identifier validation,
  origin guard, body limits, atomic documents + corrupt detection, persistence API
  round-trip / bad payload / 405 / corruption / oversized, service bridge validation +
  forwarding + pass-through status + CSRF + wrong content type, `/api` proxy token
  forwarding and 503 without a token, **WebSocket proxy over plain HTTP**, **WebSocket
  proxy over HTTPS with a `/core` base path** (asserts TLS upgrade, path preservation and
  that browser cookies are not forwarded), upgrade refused without a token, calendar
  bridge mapping/validation.
- `src/utils/bounded-map.test.ts` (5): ordering, concurrency ceiling, partial failure,
  empty input, abort detection.
- `src/hooks/useCalendarEvents.test.tsx` (4): merge + ordering, partial failure, bounded
  concurrency (peak ≤ 6), stale-range suppression.
- `src/api/beacon-store.test.ts` (existing file extended): rejected HTTP write reported as
  `persisted: false` with status, overlapping writes serialised.

Coverage reporting (`vitest --coverage`) is available but no threshold is enforced yet
(see H).

---

## E. Performance report

| Change                         | Effect (measured / reasoned)                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Calendar fan-out, 14 calendars | Test asserts peak in-flight requests ≤ 6 (was 1 at a time, so wall time ≈ N×RTT).       |
| Stale-range suppression        | Old range can no longer repaint the calendar after a newer one loaded (test covers it). |
| Polling while hidden           | Zero REST polls while `document.hidden` (previously 2/min per device forever).          |
| Atomic persistence             | Removes a class of recovery reloads caused by truncated JSON.                           |

No React render profiling was performed in this pass; memoisation was deliberately not
added blindly (see H).

---

## F. Security report

Fixed: HTTPS/WSS proxying (was silently broken), CSRF/origin guard on token-bearing
endpoints, path-traversal via `domain`/`service`, unbounded body reads, unclean socket
teardown, leaking filesystem error text, non-atomic persistence.

Remaining assumptions (documented, not changed):

1. Standalone deployments rely on network isolation; the container has no authentication
   of its own. Adding one would break existing installs, so it is a product decision.
2. The server-side token keeps full HA permissions. A least-privilege HA user is
   recommended in `SECURITY.md` (not enforced by code).
3. PINs remain a convenience control for children, not an authorisation boundary.
4. HA ingress is trusted to authenticate; the origin guard only defends against
   cross-site requests, not against a local attacker on the same origin.

---

## G. Developer documentation

- `CLAUDE.md` updated: backend layout (`server.js` + `server/app.cjs`), the new test
  commands, and the fact that the image builds from the repo root while `beacon/` is a
  legacy mirror.
- `npm run test:server` and `npm run test:all` added; CI runs the backend suite.

---

## H. Remaining recommendations (prioritised)

1. **Lint + format gate** — add `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`,
   `prettier` and a `lint` script, then a CI step. Not added here because it requires new
   devDependencies and a repo-wide format pass; doing it blindly in the same change would
   bury the reliability fixes in noise.
2. **Split the three large modules** (safe order): `ChorePlanner` → board/card/mission/
   editor/reward + `hooks/`, then `SettingsView` → one component per section, then
   `choreops.ts` → `parse`/`normalise`/`actions`/`resolve` with an index barrel. Each step
   is behaviour-preserving and already covered by the existing tests.
3. **Coverage gate** — `vitest --coverage` with thresholds on `src/api`, `src/hooks`,
   `src/utils`; backend coverage via `node --test --experimental-test-coverage`.
4. **Playwright smoke suite** — onboarding, HA connect, add/edit calendar event, chore
   create + complete, app reload recovery, against the Docker image with a mocked HA.
5. **Standalone auth** — optional `BEACON_API_KEY` (header or cookie) that is off by
   default, so existing installs keep working.
6. **Reduce the mirror** — `beacon/` is unused by the image build; if no installed add-on
   points at it, delete it and keep one source tree. Until then the sync check stays.
7. **Persistence conflict resolution** — `saveData` serialises per key in one tab; two
   tabs still last-write-wins. A version counter in the document would make conflicts
   detectable.
