# Choresman

Choresman is Abbai Flow's local chore, reward, and family gamification provider.
It is available at `/abbai-flow/choresman` and can be selected beside ChoreOps
in **Settings → Chores**. It runs without a Home Assistant URL or token.

## Family profiles and ownership

Abbai Flow remains the source of truth for family profiles. When Choresman is
selected, the app syncs its existing family profiles to the store using the
same stable Abbai Flow IDs. Names, roles, avatars, and colors are refreshed
from those profiles; chore assignments, points, claims, rewards, and history
refer to those IDs. The Choresman provider does not create or link Home
Assistant or ChoreOps users. `family.create_member`, `family.update_member`,
and `family.delete_member` are available for isolated module use; the integrated
app manages family changes through Abbai Flow and syncs the result.

## Persistence

The module stores a versioned JSON document at
`$ABBAI_FLOW_DATA/choresman.json` (default: `/data/choresman.json`). Writes are
serialized per file within the server process and use a temporary file plus
rename. The file and temporary file are created with owner-only permissions
where supported. Tests inject a temporary data directory.

## API conventions

`ChoresmanStore.call()` accepts `choresman.*` actions and snake_case payloads.
Chore, reward, and advanced action names follow the [ChoreOps Services
Reference](https://github.com/ccpk1/ChoreOps/wiki/Services:-Reference). The
local HTTP endpoint accepts `{ "action": "...", "data": { ... } }`, then
returns the action result with a fresh snapshot.

Supported action groups include:

- Chore CRUD, assignment, claiming, approval/disapproval, due-date set/skip,
  member pauses, and the ChoreOps recurrence and claim-window fields.
- Completion criteria for independent/shared chores and rotation modes,
  including turn control, reset/open-cycle controls, per-member schedules,
  approval reset modes, pending-claim handling, and never-overdue rotation.
- Reward CRUD and redemption approval, point adjustments, bonuses, penalties,
  ledger history, multiplier awards, and transactional-data reset.
- Periodic, daily, cumulative, special, and linked badges; badge streak history
  and repair; achievements; challenges; and scheduled goal maintenance.
- Chore rescheduling/reset, activity reports, UI-control persistence, and
  notification preferences including channel, importance, Android priority,
  and TTL.
- Family profile synchronization and local notification queue inspection and
  acknowledgement.

The module's interface is service-shaped for migration compatibility; it is not
a complete Home Assistant or ChoreOps runtime. Notification actions create a
local durable outbox and acknowledgement state. The module does not invoke
ChoreOps `notify.*` services or send push notifications itself. The notification
channel, importance, priority, and TTL are retained on each queued notification
so a future delivery adapter can honor them.

## Calendar data

Choresman chore records include assignee IDs, recurrence, per-member due dates,
and `show_on_calendar`. The provider adapter exposes those chores to Abbai
Flow's calendar using the synced family profiles and current due date. Chores
without a due date are treated as current calendar items for `none` and `daily`
frequency; other recurring chores appear on their due date.

The server runs scheduled maintenance once at startup and every minute. It
processes due boundaries, rotation skips, reminders, overdue rules, member
unpauses, badge-cycle changes, and challenge expiry without Home Assistant
automations.

## ChoreOps behavior reference

The advanced chore fields follow [Advanced Chores](https://github.com/ccpk1/ChoreOps/wiki/Advanced:-Chores).
Streak repair follows the behavior described in [ChoreOps PR #298](https://github.com/ccpk1/ChoreOps/pull/298): repair a periodic badge's streak
from recent history or an explicit `badge_streak_count`, retain the actor and
optional reason in the event, and award the badge if the repaired count reaches
its threshold. Streak repair rejects unsupported badge metrics such as days or
no-overdue goals.

This provider is intended for side-by-side testing with ChoreOps. A Choresman
snapshot is stored independently in JSON and does not migrate or rewrite the
Home Assistant ChoreOps database.
