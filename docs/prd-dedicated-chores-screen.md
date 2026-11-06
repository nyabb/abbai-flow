# PRD: Beacon Chores and Rewards (ChoreOps-backed)

## Purpose

Define the current product requirements for Beacon's family chores experience. The immediate focus is a clear, touch-friendly chore board for children and parents, backed by Home Assistant ChoreOps. Calendar integrations, notes, shopping lists, recipes, and meal planning are intentionally deferred.

## Product Principles

- **ChoreOps is the source of truth** for chores, assignments, chore status, points, rewards, and ChoreOps actions. Beacon must not create a competing local chore ledger.
- **Beacon family profiles are presentation and household settings.** They provide names, avatars, colors, parent/child role, and the parent approval PIN, and link to a ChoreOps user.
- **Never guess identity or authority.** Use ChoreOps user names and discovered entity metadata for links/actions. Do not infer parent privileges from the presence of approve buttons.
- **Build for a shared touchscreen first.** The primary experience is a wall-mounted display, with responsive behavior for tablets and phones.

## Current ChoreOps Data Contract

Beacon discovers Home Assistant entities by their ChoreOps `purpose` attributes; entity IDs and names must not be hardcoded.

- **Users:** `user_name`, points balance, and chore counters including due today, claimed, approved, and completed today.
- **Chores:** shared chore sensors provide chore name, assignees, default points, and status. Per-user status sensors provide the user's status for a chore.
- **Actions:** ChoreOps publishes per-user/per-chore claim, approve, and disapprove buttons. Beacon must discover and call the advertised button entity.
- **Unassigned chores:** ChoreOps may not publish a claim button when nobody is assigned. Beacon can offer a user picker and use ChoreOps assignment followed by claim.
- **Rewards:** reward status entities provide reward name, cost, pending claims, and action buttons. User points are used to show progress toward a reward.
- **Pending approvals:** ChoreOps provides household-level pending chore and reward approval counts when available.
- **Transport:** use the Home Assistant WebSocket when available, otherwise the Beacon REST proxy and polling fallback. Show loading, unavailable, and action-error states without silently inventing or changing ChoreOps data.

### Data Not Currently Exposed

- The inspected ChoreOps user and system-helper entities do not expose a parent/child role, admin flag, or approval privilege mapping. Claim/approve/disapprove buttons appear for users without distinguishing their household role.
- Therefore Beacon must not automatically promote a member to parent based on ChoreOps buttons or counters. Parent/child role remains a Beacon family-profile setting unless ChoreOps exposes a verifiable role field in a future version.
- ChoreOps points and reward progress do not, by themselves, imply individual savings pots, shared goals, point transfers, or manual point corrections.

## Family Profiles and Linking

1. A family profile can link to one ChoreOps user using `choreops_user`. An exact case-insensitive name match may establish the link when no explicit link exists.
2. ChoreOps users without a linked Beacon profile must not create duplicate family profiles automatically.
3. When linked, merge the latest ChoreOps snapshot into the existing Beacon family record: points, due-today count, claimed count, approved count, and completed-today count.
4. ChoreOps refreshes must preserve Beacon-owned fields: profile ID, display name, avatar/photo, color, role, calendars, and PIN.
5. In local development, the member record is stored in browser local storage. In the add-on, the server-persisted Beacon data is authoritative and local storage is a cache.
6. A parent PIN is entered and managed in Beacon's family profile. It is not a ChoreOps field. Normalize to digits and require at least four digits for the approval gate; never log the PIN value.

## Chore Board Requirements

1. Chores are a first-class screen, not a slide-over panel.
2. Show chores in separate, color-coded columns by assigned family member, with the child's column as the primary organizing pattern. A parent-assigned chore gets its own member column; an unassigned chore appears in a clearly labeled shared/unassigned column.
3. Each column has a stable member header with avatar, name, and chore count. Keep cards in that member's column; do not interleave chores across children.
4. On a large touchscreen, show as many member columns side by side as fit legibly. Collapse to fewer columns and ultimately one column on narrow screens. Avoid horizontal overflow on phones.
5. Each chore card displays the ChoreOps name and status, optional icon and point value, and only a useful action for the current state. Completed chores are visibly complete and cannot be claimed again through Beacon.
6. Reflect ChoreOps state rather than maintaining a second Beacon completion state. Refresh after an action and on incoming Home Assistant state changes; poll when a live subscription is unavailable.
7. Show household totals for due, claimed, approved, and completed chores when those counters are available. Also surface ChoreOps pending-approval counts.

## Chore Actions and Approval

1. **Claim an assigned chore:** press its discovered ChoreOps claim button; do not require a parent PIN.
2. **Claim an unassigned chore:** let the child select their ChoreOps user, then assign and claim through ChoreOps. Report failures in Beacon and leave ChoreOps as the authority on the resulting state.
3. **Approve or decline a claimed chore:** require a Beacon parent PIN before pressing the corresponding ChoreOps button. A child must not be able to approve their own work on the shared display.
4. Accept a matching PIN from any Beacon family member whose role is parent and whose configured PIN is valid. Do not send the PIN to ChoreOps.
5. A successful ChoreOps action gives immediate visual feedback; a failed action shows an actionable error and clears the busy state.
6. Do not enable approvals solely because a ChoreOps approve button exists. Require a configured Beacon parent PIN.

## Rewards

1. Show ChoreOps rewards with their name, point cost, status, and progress based on the linked user's current points when a user is identifiable.
2. Expose reward claim/redeem actions only when ChoreOps indicates the reward can be claimed.
3. Gate reward approval and decline actions behind the same Beacon parent PIN as chore approval.
4. Do not add a separate local balance, savings pot, goal transfer, or point-correction ledger in this phase.

## UX and Accessibility

- Prioritize readable type, large touch targets, generous spacing, and clear child-to-column ownership at wall-display distance.
- Use member colors and avatars consistently, while keeping status text and actions understandable without color alone.
- Keep loading, no-ChoreOps, no-chores, approval-locked, pending, and error states distinct.
- Respect reduced-motion preferences. Celebration animation or sound must be optional and must not delay the next action.
- Keep parent PIN entry masked, numeric, keyboard accessible, and dismissible.

## Deferred Scope

These are not requirements for the current chores milestone:

- External calendar sync, calendar agenda views, school timetable bundling, birthdays, and weather.
- Notes, to-do lists, shopping/grocery lists, recipes, and meal planning.
- Email/passwordless family accounts, per-member sign-in, and a separate mobile companion app.
- Creating or editing ChoreOps chores inside Beacon; Chores remain managed through Home Assistant/ChoreOps.
- Beacon-defined custom routines, recurrence rules, deadlines, late/retry/expiry windows, routine pause, and mission mode unless those capabilities are explicitly available from ChoreOps.
- Savings pots, shared goals, point transfers, manual balance correction, and premium billing.

## Acceptance Criteria

- Linking a Beacon profile to a ChoreOps user merges the user's available counters into that profile and preserves its PIN and other settings.
- Refreshing ChoreOps data does not create duplicate family profiles or overwrite Beacon-owned profile fields.
- The chore board groups assigned chores into separate member columns and unassigned chores into a separate group; the layout remains usable at 1920x1080 and on mobile.
- Claim, unassigned-claim, approve, decline, reward, loading, and failure flows use discovered ChoreOps entities/services and reflect the returned Home Assistant state.
- Claiming needs no parent PIN; approving or declining a chore/reward requires a valid Beacon parent PIN.
- Beacon never infers parent privileges from ChoreOps button presence and never logs a PIN value.
- The UI remains functional with WebSocket updates and with the REST polling fallback.
- `npm run build` and the focused ChoreOps/family tests pass, and `beacon/src/` stays synchronized with `src/`.
