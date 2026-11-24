# UI state machine inventory

This inventory covers multi-step UI and async flows where two or more values
jointly determine what the user can see or do. Simple independent choices such
as a selected tab or an enabled/disabled preference are excluded unless they
interact with another state.

## Inventory

| Flow | Current states and transition source | State model | Main risk / next improvement |
| --- | --- | --- | --- |
| App navigation and focus display | `App.tsx`: `activeView`, URL/storage focus member, family loading timeout, and invalid-member fallback | Partly implicit. Focus moves through unassigned, waiting, active, and invalid states using a member id plus a timeout boolean. | Represent focus resolution as a small union so loading and invalid assignment cannot be confused. Preserve the current URL-over-storage precedence. |
| Calendar event editor | `App.tsx`: event dialog; `EventModal.tsx`: form, `submitting`, and `error` | The shell now uses `closed | create(prefill) | edit(event)`. Submission still has an implicit saving/error pair. | Model submit status as `idle | submitting | error` if operation feedback is extended. |
| Home Assistant onboarding and auth | `OnboardingView.tsx`: numbered step, `connecting`, auth method, URL/token errors; `useHaAuth.ts`: credential loading and onboarded flag | Implicit. Step and operation flags can describe combinations that are not valid in the current screen. | Model onboarding phases and their data together. Keep secure credential storage and OAuth navigation as side effects of explicit transitions. |
| Connectivity | `useConnectionStatus.ts`: `online`, `beacon-down`, `ha-down`, `offline`; `useHomeAssistant.ts` connection lifecycle | The visible connection status is explicit; transport/auth details and several dependent booleans remain distributed. | Keep the four user-facing states as the common contract; document transition ownership if reconnection behavior changes. |
| Remote data loading | `useCalendarEvents.ts`, `useWeather.ts`, `useWeatherForecast.ts`, `useGrocery.ts`, `useTaskLists.ts`, `usePhotos.ts`, `useMusic.ts`, `useTaskmate.ts` | Mostly implicit `data + loading + error/availability` tuples, with cancellation and stale-result rules inside individual hooks. | Standardize only where a caller currently renders contradictory loading, empty, or error UI. Avoid replacing APIs wholesale without evidence of a user-facing mismatch. |
| Grocery and shopping lists | `GroceryView.tsx`: list discovery, selected list/tab, item loading/error, add submission, optimistic toggle and rollback | Implicit overlapping operations. `loading` covers discovery and item refresh; toggle is optimistic but has no per-item pending state. | Separate discovery from selected-list load and give mutations an explicit pending/result state, so refreshes cannot be mistaken for writes. |
| Chore planner screens and sheets | `chore-planner/ChorePlanner.tsx`: board/child/missions/mission/closing screens; forms; action, claim, award, goals, reward, assignment, PIN, and confirmation overlays | Screen names and domain chore statuses are explicit. Sheet kind and sheet context were split across independent ids/flags; the sheet state is now a discriminated union in `chore-planner/overlay-state.ts`. | The mission run still keeps member, queue, and index separately. A follow-up can make that one typed mission state if this flow is extended. PIN and network writes remain separate because they can overlay the current sheet. |
| Family and routine settings | `settings/sections/FamilySection.tsx`: member edit/list form, photo errors, member deletion, routine selection/form/deletion | Implicit. Member and routine editor values are independent, so stale form context can survive a view change. | Make the active editor a union carrying its target id and form; keep destructive confirmation attached to the target being deleted. |
| Child focus actions | `focus/FocusView.tsx`: exit confirmation, chore confirmation; `focus/RoutineCard.tsx`: animation target | Independent booleans/ids. The current actions are small but can overlap or retain a stale chore id. | Keep confirmation target and dialog kind together if more focus actions are added. |
| Display idle and timer lifecycles | `ScreenSaver.tsx`: explicit `awake | dim | screensaver`; `useDisplayMode.ts`: wake lock and fullscreen capability/activity; `utils/timer-state.ts` and `useTimers.ts`: timer lifecycle | Screen saver and countdown timer phases are explicit. Wake lock and fullscreen are independent browser capabilities and should remain separate. | Preserve these explicit models. Treat a finished timer as an alarm state until dismissed, and keep display idle from navigating away during unsaved work. |
| Small editors and utility overlays | `SettingsView.tsx`, `MusicView.tsx`, `TimerDock.tsx`, `PhotoFrame.tsx`, `EventDetailsPopover.tsx` | Mostly independent local visibility or selection flags; not all are workflows. | Promote only when two values jointly control the same overlay or a bug demonstrates stale context. |

## Change made

The app shell now stores the calendar dialog as `closed | create(prefill) |
edit(event)`, so create defaults cannot coexist with an edit target.

The chore planner stores each open sheet and its required context in one
discriminated state. Opening another sheet replaces the full previous context;
closing clears it; the delete confirmation step exists only while the task
actions sheet is open. Form edit ids, selected task ids, and reward/member
targets are derived from the active sheet instead of being separate mutable
state. See `src/components/chore-planner/overlay-state.ts`.

Existing transitions retain their behavior. The new-goal action now also resets
the reward form consistently when its task has no member, avoiding reuse of a
stale reward editor value. The inventory records the remaining places where
state is coordinated manually so future changes can target the highest-risk
transitions without introducing a new state framework.
