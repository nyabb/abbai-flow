# Migrating an existing household (Phase 6)

What happens to data that already exists when Beacon gains explicit routines and
an explicit reward lifecycle. The guiding rule: **nothing is deleted, nothing is
re-awarded, and no reward is ever marked as given by a migration.**

## 1. Chores and daily labels → routines

ChoreOps chores are untouched. Beacon only reads them.

On first load with the new code, `adoptLabels()` turns each existing ChoreOps
label on a **daily** chore into a routine definition:

| Before (ChoreOps)                              | After (Beacon metadata)                                             |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `labels: ['Ochtendroutine']` on 3 daily chores | one routine `ochtendroutine`, `taskNames: [chore1, chore2, chore3]` |
| `labels: ['ochtendroutine']` (different case)  | the **same** routine — the slug matches                             |
| daily chore without a label                    | stays a plain daily chore, listed under "other daily tasks"         |

Adoption is **idempotent**: it runs on every render pass where an unregistered
routine is visible, and `upsertRoutine`/`addRoutineTask` reuse the existing
routine and skip tasks that are already members. Running it twice (or on two
devices at once) cannot produce duplicates.

The ChoreOps label stays in place, so removing Beacon's metadata document simply
falls back to the old label grouping — that is the rollback path.

## 2. Reward reservations → pursuits

The old build stored reward allocations in `localStorage` under
`beacon_reward_reservations`. `migrateReservations()` imports them once:

- each reservation becomes a redemption in state `saving`;
- a reservation whose cost is known and already covered becomes
  `awaiting_fulfilment` (never `fulfilled`);
- a reservation for a reward that already has a pursuit is skipped;
- the legacy key is then removed.

Points are not touched, and no ChoreOps call is made — importing progress cannot
award or deduct anything.

## 3. Points, balances, reward definitions, PINs

Untouched. They live in ChoreOps (points, reward cost) and in Beacon's family
settings (PIN, photos). The planner reads them exactly as before.

## 4. Duplicate labels

Two spellings of one routine (`Ochtendroutine`, `ochtendroutine `) collapse into
one entry because identity is the slug, not the string. If a household really
wants two routines, the names have to differ beyond case and spacing.

## 5. Safety and recovery

- The migration only **adds** to `beacon-planner-meta` and
  `beacon-reward-redemptions`; it never removes chores, rewards or points.
- Both documents are versioned; an unreadable or partial document falls back to
  an empty model rather than throwing (`sanitizePlannerMeta`,
  `sanitizeRedemptions`), so a corrupted file cannot lock the screen.
- To undo: clear the two keys (Settings → clear site data, or delete the
  `/beacon-data/` documents). ChoreOps is unaffected and the labels regroup as
  they did before this release.

## Tested

- `planner-meta.test.ts` — label adoption merges case variants, is idempotent,
  prunes chores that no longer exist, and imports the old pause flag once.
- `reward-redemptions.test.ts` — reservations import as `saving`/`awaiting`
  (never `fulfilled`), and a second import does not duplicate a pursuit.
