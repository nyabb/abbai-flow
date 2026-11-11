# Chore Planner Prototype (local preview)

An original, touch-first chores and routines experience for the wall display, built to explore
the chore and "Vandaag" flows described in `prd-dedicated-chores-screen.md`.

This is the **seeded design preview** for flows ChoreOps cannot express on its own (for example
retry windows and expiry copy). Home Assistant ChoreOps is the source of truth for the real
Chores screen in every build.

## Access

| Mode                               | How                                     | Data source                                       |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------- |
| Live planner (default, all builds) | Open **Chores**                         | Home Assistant ChoreOps + Abbai Flow family profiles  |
| Classic board (dev only)           | `http://localhost:3001/?chores=classic` | ChoreOps, with the claim picker and decline       |
| Seeded prototype (dev only)        | `http://localhost:3001/?chores=demo`    | `localStorage` key `beacon_chore_planner_demo_v1` |

Reset the prototype by clearing the `beacon_chore_planner_demo_v1` key (and
`beacon_chore_demo_language` for language).

## Live planner behavior

The default Chores screen renders ChoreOps data in the planner layout:

- **People** come from Abbai Flow family settings — photo, avatar, colour, and display name —
  joined to ChoreOps users by `choreops_user` or name. Unlinked users fall back to their
  ChoreOps name and a neutral avatar.
- **Chores** come from ChoreOps status sensors and action buttons: name, status, points,
  due date, and icon (`mdi:` icons map to a readable emoji).
- **Actions** press the ChoreOps buttons: a claim is immediate, while approving a chore the
  child finished requires a Abbai Flow parent PIN. Decline and the unassigned claim picker live on
  the classic board (`?chores=classic`).
- **Creation and deletion** go through `choreops.create_chore` and `choreops.delete_chore`;
  Abbai Flow never keeps a second chore ledger.

Demo-only affordances (routine pause, retry/expiry copy, undo, point destinations) are hidden
when the board runs on ChoreOps, because ChoreOps owns those rules.

The live board's **+** button creates the chore in ChoreOps with `choreops.create_chore`:

- Name (required) and one or more assignees (required, listed from ChoreOps users)
- Points, and repeat: one-time, daily, weekly, or monthly
- Weekday selection when repeat is weekly

Abbai Flow sends only the fields you set, then re-reads ChoreOps so every display agrees. Save stays
disabled until a name and at least one assignee are present. ChoreOps keeps its own defaults for
due dates, notifications, and approval rules, which stay editable in Home Assistant.

## Seeded state

First load seeds one family with four members and enough data to inspect every task state:

- **8 task instances** covering `upcoming`, `active`, `late`, `retry`, `expired`, and `completed`
- **2 routines** (morning and evening)
- **2 goals** (one personal, one shared)
- A routines-paused demo toggle, plus a free/unassigned chore and an expired free chore

## Implemented behavior

- Task cards with status ring, icon, title, status copy, points badge, assignee, and time chip
- Check button is the only completion target (no accidental tap-to-complete), with a disabled
  pending state and rollback messaging
- Section grouping: free to claim, today, late, and a collapsed completed list
- Per-member and status filters (AND combined)
- Create/edit sheet: task vs routine (locked after creation), icon picker, points stepper,
  multi-member selection, everyone/free-task selection, deadline shortcuts, retry grace window,
  frequency and weekday selection, and custom time blocks
- Pause/resume routines with an amber banner; resume creates tasks from now only
- Point destination sheet appearing only when points are awarded, with pot and eligible goals
- Undo flow that restores a completed task and retracts exactly what each pot/goal received
- "Vandaag" lobby → welcome (real weather and next appointment when available) → overview →
  missions → full-screen mission mode with progress → closing summary
- Privacy blur, sound toggle, Dutch/English switch, offline banner that disables check-off,
  and reduced-motion support

## Deliberately out of scope

Calendar editing, lists, shopping, recipes, meal planning, accounts, and a companion app remain
separate work. The prototype does not write to Home Assistant.
