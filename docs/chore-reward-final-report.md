# Chores, routines, missions and rewards — final report

Companion to `docs/chore-reward-review.md` (investigation), `docs/chore-reward-persistence.md`
(Phase 5) and `docs/chore-reward-migration.md` (Phase 6). This file is the closing record of the
8-phase rebuild: what was broken, what the model is now, and what remains ChoreOps' call.

## 1. Root causes

1. **One button did two jobs.** The child's check button pressed `approve` whenever the chore was
   awaiting review, so a child could approve their own work; the only "gate" was a confirmation
   dialog. ChoreOps publishes `can_approve: true` on the child's _own_ status entity, so the
   integration never enforced this either — authorization was nobody's job.
2. **A routine was a string.** Routines existed only as `labels[0]` on daily chores. No identity
   (two spellings = two routines), no ordering (ChoreOps has no position field), and routine steps
   were simultaneously individual chores, claimable from the board.
3. **Missions were a flat queue** of every open chore, sorted by routine then deadline. Progress was
   React state, so a refresh reset the position.
4. **Reward progress was a device-local reservation** (`localStorage`), written by a function that
   swallowed every error. "Goal reached" and "reward given" were the same flag, there was no
   record of who gave what, and a fully funded goal could be deleted by the child.
5. **Pause state was per device**, so two tablets disagreed about whether a routine was running.

## 2. The revised task / routine / mission model

```
Chore (ChoreOps)            Routine (Beacon)                     Mission (Beacon progress)
─────────────────           ─────────────────                    ─────────────────────────
available                   id: slug (stable)                    keyed per ChoreOps user
awaiting_approval           name, icon, paused                   routineId + completed[]
approved / rejected         taskNames[] (execution order)         startedAt / updatedAt
points (0 allowed)          memberIds derived from ChoreOps
```

- A daily chore that belongs to a routine is a **routine step**: `inRoutine: true`. It is not listed
  in the child's individual chores, cannot be claimed from the board, and is only executed from the
  mission screen (`C10`).
- Standalone chores keep the individual workflow (check → parent approves, or auto-approve).
- A routine's steps run **in registry order**, one at a time, with `done/total` progress taken from
  persisted progress — not from the in-memory queue.
- Only routines enter a mission; paused routines are excluded (`B14`, `C9`).

## 3. The revised reward lifecycle

```
saving ──(points reach cost)──▶ awaiting_fulfilment ──(parent, PIN)──▶ fulfilled
   ▲                                    │
   └──────────(child undoes)────────────┘
```

- Allocation is the child's action and never touches ChoreOps; the amount is clamped to what the
  goal still needs, so a goal cannot absorb points twice.
- `awaiting_fulfilment` is _goal achieved, waiting for a parent_ — visibly different from a saved
  goal and from a given reward.
- Only a parent can hand it over: the action lives in the goals sheet's **Rewards to give** queue,
  behind the PIN, and it calls `choreops.approve_reward` (the real deduction) with the parent's name.
- Fulfilment writes `fulfilledAt`/`fulfilledBy`, removes the pursuit from the child's active goals
  and keeps it in the **Given rewards** history. The reward _definition_ is never deleted, so the
  same reward can be earned again.

## 4. How parent-only authorization is enforced

| Path                                                              | Gate                                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Approve a chore completion                                        | Row actions → "Approve completion" → PIN; the child's check button refuses and says it waits for a parent |
| Mark a reward as given                                            | Goals sheet → "Mark reward as given" → PIN, then `approve_reward`                                         |
| Create / edit / delete a chore or reward                          | PIN (unchanged)                                                                                           |
| Child actions (claim, complete, save points, undo, start mission) | none — they are the child's own steps                                                                     |

A household without a parent PIN still gets a working screen (the gate cannot be unlocked by
anybody, so requiring it would brick the app); configuring a PIN turns all parent actions into
PIN-protected ones. This is the same rule the rest of Beacon uses.

## 5. Shared persistence

- `beacon-planner-meta` — routines, step order, pause state, mission progress.
- `beacon-reward-redemptions` — pursuits and fulfilment history.
- Both via `beacon-store`: server is authoritative in add-on mode (`/beacon-data/:key`), localStorage
  caches, writes are serialised per key, and a write that only reached the cache raises an error
  toast instead of being reported as saved.
- Identifiers: routine slug (renames keep the id), generated redemption id (a `user+reward` pair
  repeats over time and cannot be a key). ChoreOps keeps owning its own data.

## 6. Migration

Existing households are upgraded in place: daily labels are adopted as routines (idempotent, case and
space insensitive), old localStorage reservations import once as `saving`/`awaiting_fulfilment`
pursuits, and points, reward costs and PINs are untouched. No reward is ever marked given by the
migration, and deleting the two Beacon documents restores the previous label-based behaviour.
Details and rollback: `docs/chore-reward-migration.md`.

## 7. Files changed

New:

- `src/api/planner-meta.ts` + tests — routine registry, step order, mission progress, tolerance.
- `src/api/reward-redemptions.ts` + tests — redemption lifecycle and shared persistence.
- `src/hooks/usePlannerMeta.ts`, `src/hooks/useRewardRedemptions.ts` — hydration + write reporting.
- `src/components/test/ChorePlanner.routines.test.tsx`, `ChorePlanner.rewards.test.tsx`.
- `docs/chore-reward-review.md`, `chore-reward-persistence.md`, `chore-reward-migration.md`, this file.

Changed:

- `src/api/chore-planner-model.ts` — `inRoutine`, `routineOrder`, `autoApprove`, routine `taskNames`/`paused`.
- `src/api/chore-planner-view.ts` — routine resolution through the registry (label as fallback), ordered steps.
- `src/components/chore-planner/ChorePlanner.tsx` — routine-aware board/missions, approval behind the PIN,
  redemption wiring, persistence warnings, shared pause state.
- `src/components/chore-planner/{ChoreEditor,sheets,rows,copy}.tsx` — routine picker, approve action,
  rewards-to-give queue, given history, corrected labels.
- `src/i18n/translations/*.ts` (9 locales) — approval, goal achieved, waiting for reward, given,
  routine picker keys.

## 8. Tests and results

| Area                                                                                 | Tests                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------- |
| Routine identity/order/missions                                                      | 23 (`planner-meta.test.ts`)              |
| Reward lifecycle + cross-device                                                      | 22 (`reward-redemptions.test.ts`)        |
| Routines in the UI (steps hidden from chores, order, paused routine)                 | 4                                        |
| Reward lifecycle end-to-end (saving → PIN → `approve_reward` → given → pursue again) | 2                                        |
| Approval/rejection/zero-point/auto-approve                                           | 20 (`chore-planner-view.test.ts`, 4 new) |

`npx tsc --noEmit` clean · **464 tests / 56 files passing** · `npm run build` succeeds ·
`./scripts/check-beacon-sync.sh` reports `src/` and `beacon/src/` identical.
`npm run lint` could not run in this environment (`eslint` is not installed locally; `npx eslint`
tried to fetch it), so lint is unverified here.

## 9. Remaining limitations (ChoreOps)

- No routine entity, so routine membership is a Beacon registry keyed by **chore name**. Renaming a
  chore in Home Assistant detaches it from its routine until it is added again (the label still
  groups it visually).
- No ordering field, so step order lives in Beacon; editing chores in HA cannot reorder a routine.
- `can_approve` on the child's own entity means ChoreOps itself has no notion of _who_ may approve;
  only the Beacon UI enforces it. Anyone calling the HA service directly can still approve.
- `approve_reward` charges the reward's current cost; if a parent changes the price while a child is
  saving, the deduction uses the new cost (Beacon shows the captured cost of the pursuit).
- Chore renaming, per-step due times and sub-routine nesting are not modelled by ChoreOps and are not
  supported here.
