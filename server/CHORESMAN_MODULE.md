# ChoresMan

ChoresMan is Abbai Flow's local chore, reward, and family gamification store. The app uses it as
the single source for chores, points, claims, rewards, and chore history. Its HTTP API is available
at `/abbai-flow/choresman`.

## Family profiles and ownership

Abbai Flow remains the source of truth for family profiles. The app syncs profile IDs, names,
roles, avatars, and colors to ChoresMan so chore assignments and points stay attached to the same
family members. The app manages profile changes through its family settings; the store also exposes
`family.create_member`, `family.update_member`, and `family.delete_member` for standalone use.

## Persistence

The module stores a versioned JSON document at `$ABBAI_FLOW_DATA/choresman.json` (default:
`/data/choresman.json`). Writes are serialized per file within the server process and use a
temporary file plus rename. The file and temporary file are created with owner-only permissions
where supported. Tests inject a temporary data directory.

## API

`ChoresManStore.call()` accepts action names such as `choresman.create_chore` with snake_case
payloads. The local HTTP endpoint accepts `{ "action": "...", "data": { ... } }` and returns the
action result with a fresh snapshot.

Supported action groups include:

- Chore creation, editing, assignment, claiming, approval, due dates, recurrence, and rotations.
- Reward proposals, parent approval before redemption, point adjustments, and ledger history.
- Bonuses, penalties, badges, achievements, challenges, and scheduled goal maintenance.
- Activity reports, UI-control persistence, notification preferences, and a durable notification
  queue with acknowledgement.
- Family profile synchronization.

Reward definitions created in Abbai Flow are saved as proposals. They stay unavailable for point
allocation and redemption until a parent approves them; existing rewards remain approved.

Notifications are stored locally. The module does not send push notifications itself; it retains
channel, importance, priority, and TTL values for a future delivery adapter.

## Calendar data

Chore records include assignees, recurrence, per-member due dates, and `show_on_calendar`. Abbai
Flow groups current calendar chores under each assigned family member. Chores without a due date are
treated as current calendar items for `none` and `daily` frequencies; other recurring chores appear
on their due date.

The server runs scheduled maintenance once at startup and every minute. It processes due
boundaries, rotation skips, reminders, overdue rules, member unpauses, badge-cycle changes, and
challenge expiry without external automations.
