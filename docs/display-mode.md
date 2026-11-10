# Display Mode (wall-mounted touchscreen)

Beacon is a web app. Display Mode is the screen you point a permanent browser at:
a Raspberry Pi driving a touchscreen, a spare tablet on a kitchen wall, a TV in
the hallway.

## Pointing a device at it

Open Beacon at:

```
http://<beacon-host>:3000/display
```

Under Home Assistant ingress the path is preserved, so
`…/api/hassio_ingress/<token>/display` works too.

`/display` is detection, not routing: the app has no router, so it reads the path
once on boot. It is deliberately **not** the `?display=` query parameter — that
one already means "lock this device to one family member" (kid display).

A kiosk launch line for Raspberry Pi OS with Chromium:

```
chromium-browser --kiosk --incognito --noerrdialogs --disable-infobars \
  --check-for-update-interval=31536000 http://beacon.local:3000/display
```

`--incognito` avoids a stale profile after power cuts; the app keeps nothing in
the browser except the settings it is given.

## What is on the screen

| Panel | Content |
| --- | --- |
| Clock band | Time, date, weather, connection state, fullscreen toggle |
| Agenda | Today's events, all-day first, past events dimmed |
| Chores | Today's chores grouped per member, done/open per chore |
| Family | One tile per member with points and today's chore count |
| Navigation | Four finger-sized buttons: Dashboard, Calendar, Chores, Lists |

Everything is **read-only**. A wall screen gets brushed past constantly, so
approving a chore or editing an event stays on the screen that has a
confirmation step.

Panels are switched in **Settings → Display → Display mode → Panels**.

## Screen management

| Behaviour | Setting | Default | Notes |
| --- | --- | --- | --- |
| Keep the screen awake | `displayWakeLock` | on | Screen Wake Lock API. Re-acquired when the page becomes visible again, because browsers drop the lock on every hide. A refusal (low battery, unsupported context) is a state, never an error. |
| Start in fullscreen | `displayFullscreen` | off | Browsers only allow fullscreen after a user gesture, so a boot-time request is rejected. The view shows a toggle instead; the setting attempts it for kiosk shells that allow it. |
| Return to dashboard after | `displayIdleMinutes` | 15 | 0 disables. Suspended while a dialog, planner sheet, overflow menu or settings field has focus — a half-typed event is never lost. |
| Reduced animation | `reducedMotion` | off | Collapses animation/transition durations app-wide. Mirrors `prefers-reduced-motion`, which some kiosk shells do not report. |

## Connection states

The badge distinguishes four cases, because they need different fixes:

| State | Meaning |
| --- | --- |
| Connected | Both Beacon and Home Assistant answered |
| Home Assistant unreachable | Beacon is up, HA is not |
| Beacon unreachable | The browser has network but Beacon's own origin did not answer |
| No internet connection | The device itself is offline |

The Beacon check is a `HEAD manifest.json` with `cache: no-store` — a cached hit
would report "up" during an outage. Recovery triggers one refresh of the calendar
data; nothing else would notice the server coming back, since calendars are not
polled.

## Behaviour on a long-running screen

- Polling (weather, dashboard tasks, ChoreOps) pauses while the document is
  hidden and refreshes immediately on return.
- The clock ticks once a second and is the **only** component that re-renders at
  that rate; the panels tick once a minute.
- The display tickers stop entirely while the page is hidden.

## Verifying a build

```bash
npm test            # frontend suites
npm run test:server # backend
npx tsc --noEmit    # types
npm run lint        # eslint, expected: 0 problems
npm run build       # tsc + vite build
```

The display suites specifically:

```bash
npx vitest run src/components/display src/hooks/useDisplayMode.test.ts \
  src/hooks/useConnectionStatus.test.ts src/hooks/usePageVisibility.test.ts \
  src/styles/responsive.test.ts src/web-only.test.ts
```

`src/web-only.test.ts` also guards the packaging: it fails if Capacitor packages,
`cap:*` scripts or `android/`/`ios/` come back.
