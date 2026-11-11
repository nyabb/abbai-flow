# Abbai Flow — Engineering review

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

| #   | Sev      | Where                                 | Problem                                                                                                                                                          | Status                                        |
| --- | -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Critical | `server.js` upgrade handler           | Transport hard-coded to `http` with port `80`; an `https://` HA URL could never upgrade. Also forwarded browser cookies and had no timeout/cleanup.              | Fixed                                         |
| 2   | Critical | `haRequest()` (voice, service bridge) | Same hard-coded `http`/`80`, so HTTPS Home Assistant installs broke on `/beacon-action/service` and `/beacon-action/voice`.                                      | Fixed                                         |
| 3   | High     | `proxyToHA()`                         | Body buffered without a limit, no upstream timeout, could answer twice after a client abort.                                                                     | Fixed                                         |
| 4   | High     | `handleVoiceAction()`                 | Read the raw body with no size limit (`chunks` unbounded) — trivial memory exhaustion.                                                                           | Fixed                                         |
| 5   | High     | `/beacon-data` PUT                    | `writeFile` in place: a crash mid-write left truncated JSON that then read back as corrupt.                                                                      | Fixed (temp file + rename)                    |
| 6   | High     | `/beacon-data` GET                    | Malformed stored JSON surfaced as a raw error message / inconsistent status.                                                                                     | Fixed (typed `CORRUPT_STORE`, stable message) |
| 7   | High     | All token-bearing endpoints           | No origin check: any web page opened on the wall display could drive `/beacon-action/*` and `/api/*` against HA.                                                 | Fixed (same-origin/native-shell guard)        |
| 8   | Medium   | `/beacon-action/service`              | `domain`/`service` were interpolated into an HA path unvalidated (`../` traversal into other HA endpoints).                                                      | Fixed                                         |
| 9   | Medium   | `server.js` structure                 | 829-line monolith that started listening on `require`, so no automated test could exercise it.                                                                   | Fixed (entry + `server/app.cjs`)              |
| 10  | Medium   | `src/api/beacon-store.ts`             | PUT resolved regardless of `res.ok`, so a rejected write looked successful.                                                                                      | Fixed (typed result + error)                  |
| 11  | Medium   | `src/api/beacon-store.ts`             | Two saves of one key raced; the slower one landed last on the server.                                                                                            | Fixed (per-key write queue)                   |
| 12  | Medium   | `src/hooks/useCalendarEvents.ts`      | Calendars fetched one-by-one; a slow earlier response could overwrite a newer range; no cancellation.                                                            | Fixed                                         |
| 13  | Low      | `src/hooks/useChoreOps.ts`            | REST fallback polled every 30 s even while the tab was hidden.                                                                                                   | Fixed                                         |
| 14  | Low      | `beacon/` mirror                      | Duplicated tree; `beacon/package.json` had drifted (no test tooling). Not used by the published image.                                                           | Documented (kept for compatibility)           |
| 15  | Low      | Toolchain                             | No linter, no formatter check, no E2E harness, no coverage gate.                                                                                                 | Lint + coverage gates added; E2E open         |
| 16  | High     | `src/components/MusicView.tsx`        | Five hooks were called after an early return, so the hook count changed when the player list loaded asynchronously (React throws on that).                       | Fixed                                         |
| 17  | Low      | `package.json`                        | `@testing-library/dom` existed only as an auto-installed peer; any install that resolves peers differently (`--legacy-peer-deps`) silently emptied the test run. | Fixed (explicit devDependency)                |

Oversized modules (see H for what is still open):

| File                              | Lines before | Lines after                                    |
| --------------------------------- | ------------ | ---------------------------------------------- |
| `src/api/choreops.ts`             | 990          | 588 (split)                                    |
| `src/components/ChorePlanner.tsx` | 2481         | 1419 (orchestrator) + 1495 in `chore-planner/` |
| `src/components/SettingsView.tsx` | 2072         | 242 (shell) + 2136 in `settings/`              |
| `src/App.tsx`                     | 826          | 762                                            |

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

### C7. Domain layer split (`src/api/choreops.ts`)

The 990-line module is now parsing/normalisation plus two focused modules behind an
unchanged public API:

```
src/api/choreops.ts            parsing + normalisation (588 lines)
src/api/choreops/members.ts    user ⇄ family member resolution
src/api/choreops/payloads.ts   schedules, create/update payloads, offsets, grouping
```

`choreops.ts` re-exports both, so every `from '../api/choreops'` import kept working
unchanged (verified by the existing 79 API tests).

### C8. App shell orchestration (`src/App.tsx`)

Calendar orchestration moved out of the shell into `src/hooks/useMergedCalendars.ts`:
local calendar + HA calendars are merged in one place and create/update/delete are routed by
calendar id. The shell now renders instead of orchestrating, and the routing rules gained
their own tests.

### C9. MusicView hook-order bug (issue 16)

The empty-state early return sat above five hooks, so the first render after the player list
loaded changed the hook count (React throws "Rendered more hooks than during the previous
render" once players arrive). The return now sits after every hook.

### C10. Planner decomposed (`src/components/chore-planner/`)

```
ChorePlanner.tsx      orchestration: state, ChoreOps writes, header (1419)
ChoreBoard.tsx        member + free columns (141)
ChildView.tsx         one child's goals/chores/history/routines (135)
MissionView.tsx       missions list, single mission, closing card (118)
ChoreEditor.tsx       the chore form sheet (265)
ApprovalDialog.tsx    ConfirmSheet + PinSheet (119)
sheets.tsx            actions, award, filter, claim, goals, reward sheets (393)
rows.tsx              TaskRow / RoutineRow / RewardRow (211)
copy.ts               planner copy via i18n (138)
form.ts               form value, conversions, formatting, option tables (178)
```

`src/components/ChorePlanner.tsx` is now a one-line re-export, so the shell and the three
existing planner test files were untouched by the move. Extracting the rows also removed
the last inline `render…` helpers, which means the board decides _what_ to show and the
rows decide _how_ it looks.

### C11. Settings controls extracted (`src/components/settings/`)

`Toggle`, `Segment` and `Slider` moved to `settings/controls.tsx`. Settings had **no tests**
before this pass, so a smoke suite was added first: the screen renders, all eight sections
can be opened, and a field change reaches `onUpdateSettings`.

All eight sections are now components behind one shared `SettingsSectionContext`
(`settings`, `onUpdateSettings`, `t`), and `SettingsView.tsx` is a 242-line nav shell plus
export/import:

```
settings/sections/GeneralSection.tsx       170
settings/sections/AppearanceSection.tsx    155   theme grid, font scale, sidebar, advanced toggles
settings/sections/CalendarSection.tsx      197   visibility + colour overrides, defaults
settings/sections/IntegrationsSection.tsx  297   HA status, Grocy, AnyList, lists, photos
settings/sections/DisplaySection.tsx       192   screen saver, kiosk, kid display
settings/sections/ChoresSection.tsx         25
settings/sections/AboutSection.tsx          91   export/import/reset
settings/sections/FamilySection.tsx        301   state + writes for the family feature
settings/sections/family/MemberList.tsx    100   the member list
settings/sections/family/MemberFormView.tsx 380  the add/edit form
settings/sections/family/RoutineEditor.tsx 245   routine list + routine form
settings/sections/family/types.ts           50   MemberForm / RoutineFormValue / PersonOption
settings/controls.tsx                       89   Toggle / Segment / Slider
settings/sections/context.ts                16   SettingsSectionContext
```

Each section owns the state that only it uses — the appearance theme list, the calendar
colour editor id, the display member selection and the integrations todo-list fetch — so the
screen no longer threads eight unrelated `useState` calls or fetches shared by one section.
`FamilySection` follows the same rule internally: it keeps the form state, the HA people
lookup and the routine writes, and the three views under `settings/sections/family/` are
pure.

---

## D. Test report

Executed on 2026-11-09:

| Suite                     | Command                                    | Result                                                                                 |
| ------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Frontend (Vitest, jsdom)  | `npm test`                                 | **284 passed / 38 files**                                                              |
| Coverage gate             | `npm run test:coverage`                    | thresholds met                                                                         |
| Lint                      | `npm run lint`                             | **0 errors / 10 warnings**                                                             |
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
- `src/hooks/useMergedCalendars.test.tsx` (4): local calendar first, events merged by start,
  local events adopt the resolved colour, CRUD routed to the local store vs Home Assistant.
- `src/components/test/form.test.ts` (6): task → form value, free chores, prefill
  from the ChoreOps chore (day keys, window offset, label), empty form, clock/countdown
  formatting, toast shape.
- `src/components/test/SettingsView.test.tsx` (3): first coverage for the settings screen —
  renders, every section opens, a field change reaches `onUpdateSettings`.
- `src/components/test/AppearanceSection.test.tsx` (8): a card per theme plus
  the automatic entry, exactly one active, a pick updating the setting and the stored theme,
  the dark-mode window only when enabled, font scale / sidebar / advanced dashboard.
- `src/components/test/FamilySection.test.tsx` (9): member list with roles and
  empty state, add, edit, two-step delete, cancel, the photo-upload error path, a routine
  saved with its tasks in the arranged order, and routine delete after confirming.

Coverage measured with `npm run test:coverage` (v8):

| Group               | Statements | Branches | Functions | Lines  | Gate              |
| ------------------- | ---------- | -------- | --------- | ------ | ----------------- |
| `src/api/**`        | 51.96%     | 52.10%   | 43.96%    | 53.54% | 50 / 50 / 42 / 51 |
| `src/utils/**`      | 74.35%     | 66.00%   | 69.23%    | 72.91% | 72 / 64 / 67 / 70 |
| `src/hooks/**`      | 19.20%     | 13.73%   | 18.52%    | 20.38% | not gated         |
| `src/components/**` | 24.46%     | 21.22%   | 20.76%    | 25.84% | not gated         |
| all `src/**`        | 29.70%     | 27.12%   | 23.93%    | 30.74% | not gated         |

The thresholds act as a ratchet on the modules that carry the domain logic; the
presentational components are reported but not gated yet (see H3).

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

1. **Settings coverage** — the split is finished: `SettingsView.tsx` is a nav shell, every
   section is its own component, and `FamilySection` is down to state + writes with its three
   views in `settings/sections/family/`. Appearance and Family now have per-section tests
   (17 cases); the other six sections still rely on the screen-level smoke suite, so they are
   the cheapest place to broaden coverage before raising the `src/components/**` gate.
2. **Playwright smoke suite** — onboarding, HA connect, add/edit calendar event, chore create
   - complete, app reload recovery, against the Docker image with a mocked HA.
3. **Raise coverage gates** — `src/hooks/**` (19%) and `src/components/**` (24%) once the
   splits land; component tests for the settings and chore flows are the cheapest win.
4. **Prettier enforcement** — a `format` script exists, but `.prettierrc` was never applied
   repo-wide. Running `prettier --write .` is a mechanical but very large diff; do it as a
   standalone `chore:` commit, then add `format:check` to CI.
5. **Standalone auth** — optional `BEACON_API_KEY` (header or cookie) that is off by
   default, so existing installs keep working.
6. **Reduce the mirror** — `beacon/` is unused by the image build; if no installed add-on
   points at it, delete it and keep one source tree. Until then the sync check stays.
7. **Persistence conflict resolution** — `saveData` serialises per key within one tab; two
   tabs are still last-write-wins. A version counter in the document would make conflicts
   detectable.
8. **Remaining lint warnings (10)** — four `react-hooks/exhaustive-deps` (one is a genuine
   stale-ref cleanup in `Timer`/`DashboardGridStack`), three `react-refresh` warnings from
   files that export helpers next to components, one unused `eslint-disable`. They are
   warnings rather than errors because each needs a behavioural check, not a mechanical fix.
