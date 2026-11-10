# Chores, routines, missions and rewards — investigation and redesign

Status: **Phase 1 report** (investigation only; implementation follows on `phase-2/routines`,
`phase-3/rewards`, …).

Everything below about ChoreOps was verified against the live Home Assistant instance
(`GET /api/services`, `GET /api/states`) on 2026-11-10, not inferred from comments.

---

## 1. What ChoreOps actually provides

### Services (domain `choreops`, live service registry)

| Service | Relevant fields | Notes |
| --- | --- | --- |
| `create_chore` | `name, assigned_user_names, points, labels, frequency, applicable_days, auto_approve, completion_criteria, due_date, due_window_offset, pending_claims, …` | No ordering field. No routine field. |
| `update_chore` | same as create + `id, assignment_action` | `assignment_action: replace` swaps the assignee list. |
| `claim_chore` | `chore_name, user_name` | Child "I did it" (moves to `claimed`). |
| `approve_chore` | `chore_name, user_name, approver_name, points_awarded` | Parent sign-off; this is where points are awarded. |
| `disapprove_chore` | `chore_name, user_name, approver_name` | Sends it back to the child. |
| `create_reward` / `update_reward` / `delete_reward` | `name, cost, assigned_user_names, labels, icon, …` | Rewards are **definitions**, one entity per (user, reward). |
| `redeem_reward` | `reward_name, user_name, approver_name` | Child asks for the reward. |
| `approve_reward` | `reward_name, user_name, approver_name, cost_override` | **Fulfilment**: this is what deducts the cost. |
| `disapprove_reward` | `reward_name, user_name, approver_name` | Refund path. |
| `manual_adjust_points` | `user_name, amount, reason, approver_name` | Parent-only point adjustment. |
| `pause_user_chores` | `user_name, paused, paused_until` | Per-user, not per-routine. |

### Entities (live states)

* `sensor.<user>_choreops_chore_status_<chore>` — `purpose_chore_status`:
  `state` ∈ `pending | claimed | completed | completed_by_other | overdue | missed | …`,
  with `chore_name, user_name, assigned_user_names, labels, default_points,
  completion_criteria, auto_approve, can_claim, can_approve, claim_mode, global_state,
  last_completed`.
* `sensor.system_choreops_<chore>_global_status` — `purpose_shared_chore`: the only
  complete household inventory (a chore nobody is assigned to publishes no per-user sensor).
* `button.<user>_choreops_claim|approve|disapprove_<chore>` — per chore/user action buttons,
  discovered through `discoverActions()`.
* `sensor.<user>_choreops_reward_status_<reward>` — `purpose_reward_status`:
  `state` ∈ `available | locked | …`, with `cost`, `pending_claims`.
* `button.<user>_choreops_claim|approve|disapprove_reward_<reward>`.
* `sensor.system_choreops_pending_chore_approvals`, `…_pending_reward_approvals` — counters
  (4 chore approvals and 0 reward approvals at the time of inspection).

### Facts that constrain the design

1. **There is no routine concept in ChoreOps.** No service argument, no attribute, no entity.
   Routines exist in Beacon only as "daily chores that share a label". Identity is therefore a
   **display string**, and nothing prevents two spellings of the same routine.
2. **There is no task ordering.** `create_chore` / `update_chore` accept no position/sort field,
   and the status entities publish none. Ordered routine steps must be Beacon metadata.
3. **`can_approve` is published on the child's own status entity.** Observed:
   `sensor.maya_choreops_chore_status_test` = `claimed` with `can_approve: true`. ChoreOps does
   not model "who may press this"; it exposes the button for that user's row. **Authorization is
   Beacon's job.**
4. **Reward fulfilment does not delete the definition.** After approval the reward entity stays
   published (status flips back to `available`/`locked`); `claims`/`approvals` counters live on the
   dashboard helper. Reuse is therefore inherent — no reward re-creation needed.
5. **`approve_reward` is the deduction.** It accepts `cost_override`, so a partial allocation has to
   be settled explicitly rather than by hoping ChoreOps charges the right amount.
6. **Points are awarded at approval, not at claim** (`approve_chore.points_awarded`). A claimed but
   unapproved chore has awarded nothing yet.
7. `auto_approve` exists per chore and is the only sanctioned way to skip the parent step.

---

## 2. Current Beacon implementation — traced defects

| # | Defect | Evidence |
| --- | --- | --- |
| D1 | **A child can approve their own chore.** `completeTask()` picks `task.actions.approve` whenever `awaitingReview`, and the resulting `runLiveAction()` is called straight after a *confirmation dialog* — no PIN, no role check. The button label changes but the code path is identical. | `ChorePlanner.tsx` `completeTask`, `runLiveAction` |
| D2 | **"Approve" is presented as "Bevestigen" (confirm).** `pillLabel`/`rowHint` reuse `c.confirm`/`c.claimed` for two different legal transitions. `copy.ts`. | `ChorePlanner.tsx`, `copy.ts` |
| D3 | **Routine identity is free text.** `routineId = 'routine:' + labels[0].toLowerCase()`; `openNewForm('routine')` only prefills a daily chore and the label is typed by hand. Typos create a second routine; renaming a routine means re-labelling every chore. | `chore-planner-view.ts` (`routineLabel`), `ChorePlanner.tsx` `saveForm` |
| D4 | **Routine tasks are also individual chores.** The same ChoreOps chore renders in the child's column *and* inside the routine, and can be completed from the board. | `columnTasks`, `routineBuckets` |
| D5 | **A mission is a flat list of everything open**, sorted routine-first, not a sequence of routines with ordered steps. | `missionQueueFor`, `beginMissions` |
| D6 | **Mission progress is React state only**; a refresh rebuilds the queue from scratch and re-offers finished-by-Beacon steps (ChoreOps still hides completed ones, so the award is not duplicated, but the "2 of 4" position resets). | `missionIds`, `missionIndex` |
| D7 | **Reward allocations live in `localStorage` only.** Not shared across devices; write errors are swallowed (`writeRewardReservations` catch → no-op). | `reward-reservations.ts` |
| D8 | **Reward lifecycle has no states.** `rewardState().done` means "fully saved", and the same sheet mixes saving, achieving and giving. Fulfilment (`approve`) is available as a plain button on the child's goal row, gated by PIN only if one is configured. | `ChorePlanner.tsx` `rewardState`, `renderRewardRow` |
| D9 | **No fulfilment record.** Once `approve_reward` runs, the allocation is only dropped by an explicit undo; nothing timestamps who gave what, so "reward given" cannot be shown or audited. | `undoRewardChoice`, `approveReward` |
| D10 | **Double counting risk.** `committedPoints()` adds `pendingClaims × cost` *and* the reservation unless it recognises the same reward — a reservation for a *different* amount than the ChoreOps claim is counted twice. | `reward-reservations.ts` |
| D11 | **Paused routines are per device** (`localStorage beacon_paused_routines`). | `readPausedRoutines` |
| D12 | **No PIN = no gate.** `requestPin()` runs the action when the household has no parent PIN; a child device therefore has full parent rights. | `requestPin` |
| D13 | Zero-point chores are accepted by the payload builder (`Math.max(0, points)`) but nothing in the UI distinguishes "worth 0" from "points unknown" (`pointsOf` returns `null` → `0`). | `payloads.ts`, `choreops.ts` |

## 3. Behaviour worth keeping

* ChoreOps remains the source of truth for chore status, points, approvals and reward costs.
* Discovery by `purpose` (never by hardcoded entity id) — keep.
* Action buttons discovered from attributes (`discoverActions`) — keep, it survives renames.
* The `shared_first` "anyone" flow and the "taken by someone else" filter.
* Daily completions only count for the day they happened (`completedToday`).
* `beacon-store`'s `saveData()` already returns `{ cached, persisted, error }` and serialises writes
  per key — this is the correct persistence primitive for anything Beacon must own.

## 4. Required model changes

**Beacon-owned metadata** (one document, `/beacon-data/chore-planner-meta`, cached in localStorage):

```ts
interface PlannerMeta {
  version: 1;
  routines: Array<{
    id: string;            // slug, stable; never the display name
    name: string;
    icon: string;
    taskNames: string[];   // ChoreOps chore names, in execution order
    paused?: boolean;
  }>;
  missions: Record<string, {          // keyed by ChoreOps user name (normalised)
    routineId: string;
    completed: string[];              // chore names done in this run
    startedAt: number;
    updatedAt: number;
  }>;
  redemptions: Array<{
    id: string;                       // stable uuid
    user: string;                     // ChoreOps user name
    reward: string;                   // reward definition name
    cost: number;
    points: number;                   // points committed
    state: 'saving' | 'achieved' | 'awaiting_fulfilment' | 'fulfilled';
    createdAt: number;
    achievedAt?: number;
    fulfilledAt?: number;
    fulfilledBy?: string;             // parent name
  }>;
}
```

Task states (mapped, not stored): ChoreOps `claimed` → `awaiting_approval`; `completed` →
`approved`; `overdue`/`missed` → `rejected`/`late`; anything else → `available`.

## 5. Required UI changes

* Distinct labels and distinct code paths for child vs parent actions (D1, D2).
* Routine picker (existing routine dropdown + "new routine"), routine members chosen per task.
* Routine section shows "2 of 4" from persisted progress; paused routine disappears from missions.
* Rewards split into: **saving**, **goal achieved – waiting for a parent**, **given** (history).
* Parent-only "Mark reward as given" action, PIN-gated.

## 6. Migration

* Bootstrapping the routine registry from existing `labels[0]` values, normalised by slug, so the
  household's current routines appear as real routines without touching ChoreOps.
* Existing `localStorage` reward reservations are imported once as `saving` redemptions.
* Nothing is deleted, no points are re-awarded, and no reward is marked fulfilled.

## 7. Limitations imposed by ChoreOps

* No routine entity, so routine membership must be a Beacon registry keyed by chore name; renaming a
  chore in ChoreOps breaks its registry entry (recovered by the label fallback).
* No ordering, so routine step order is Beacon metadata.
* No "who approved" attribute on the chore (only the service argument), so the approver is recorded
  by Beacon when Beacon performs the approval.
* Approve/redeem buttons exist per user with no authorization semantics; Beacon must gate them.
