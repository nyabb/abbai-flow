# Planner data model and persistence (Phase 5)

How the chores screen stores what ChoreOps cannot, and what guarantees the store
gives. Companion to `docs/chore-reward-review.md`.

## Two stores, one rule

| Data                                                                | Owner        | Key                         | Why                                                                            |
| ------------------------------------------------------------------- | ------------ | --------------------------- | ------------------------------------------------------------------------------ |
| Chore status, points, approvals, reward definitions and costs       | **ChoreOps** | its own entities            | never duplicated in Beacon                                                     |
| Routine identity, routine step order, pause state, mission progress | Beacon       | `beacon-planner-meta`       | ChoreOps has no routine entity and no ordering field                           |
| Reward pursuits (saving → achieved → given), fulfilment audit       | Beacon       | `beacon-reward-redemptions` | ChoreOps only deducts at approval; progress between chores is not its business |

Both Beacon documents go through `src/api/beacon-store.ts`:

- **add-on mode** — `PUT /beacon-data/:key` is the store, localStorage is the
  offline cache; a failed PUT returns `{ cached: true, persisted: false, error }`;
- **standalone / dev** — localStorage _is_ the store (`persisted === cached`).

Neither module swallows the outcome: `usePlannerMeta` and
`useRewardRedemptions` expose `persisted`/`error`, and the planner raises an
error toast instead of reporting a successful save.

Writes are serialised per key, so two quick edits cannot land out of order.

## Identifiers

- Routines: slug id derived from the name once (`routineSlug`), never the display
  name and never the label string. Renaming keeps the id, so every chore link
  survives.
- Redemptions: generated id per pursuit. A `(user, reward)` pair repeats over
  time (the same reward can be earned again), so the pair cannot be the key.

## State machines

```
chore        available → awaiting_approval → approved | rejected
routine      available → in_progress → completed   (paused is orthogonal)
redemption   saving → awaiting_fulfilment → fulfilled
```

Chore and routine states are _derived_ (ChoreOps status + Beacon registry), not
stored a second time; only the redemption state and mission progress persist.

## Invariants enforced in code (each has a unit test)

1. Points can never be allocated beyond a reward's cost (`addPoints` clamps).
2. A finished pursuit cannot absorb more points and cannot be given twice.
3. A stale mission screen cannot write progress into another routine's run.
4. Marking the same routine step twice changes nothing.
5. A document that fails to parse yields an empty model instead of a crash
   (`sanitizePlannerMeta`, `sanitizeRedemptions`).
6. Nothing in either store re-awards points: points are only ever changed by a
   ChoreOps service call.

## Cross-device behaviour

Both documents are read from the server at mount and written on every change, so
two devices converge on the same routine order, pause state, mission position
and reward progress. The local cache exists to paint instantly, not to be the
truth: the first async read wins when the cache is empty, and every write
updates both.

## Rollback

Both keys are plain JSON documents with a `version` field (`planner-meta`) or an
array of records (`redemptions`). Rolling back a release that wrote them is safe:
older code reads its own keys, and the extra documents are ignored. To reset a
single device, delete the two localStorage keys — the server copy is restored on
the next load.
