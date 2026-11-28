/**
 * The board screen: one column per family member plus the column of chores
 * nobody owns yet.
 *
 * It renders only what the planner hands it (already filtered tasks, routines
 * and row renderers), so the board has no ChoresMan knowledge of its own.
 */
import { useEffect } from 'react';
import { Hand, ListChecks, Plus, RefreshCw, Target } from 'lucide-react';
import type { PlannerMember, PlannerTask } from '../../api/chore-planner-model';
import type { Routine } from '../../types/family';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MemberAvatar } from '../MemberAvatar';
import type { PlannerCopy } from './copy';
import { usePersistentState } from '../../hooks/usePersistentState';

export interface ChoreBoardProps {
  /** Members a parent has not filtered out. */
  boardMembers: PlannerMember[];
  /** Open chores of one member, late first. */
  columnTasks: (memberId: string) => PlannerTask[];
  /** Routines that belong to one member. */
  columnRoutines: (memberId: string) => Routine[];
  /** Whether the child has anything left to run (routines, not loose chores). */
  canRunMissions: (memberId: string) => boolean;
  /** Chores still up for grabs, deduplicated by name. */
  freeTasks: PlannerTask[];
  /** Select the child's chore list after they claim a shared chore. */
  claimNavigation?: { memberId: string; request: number } | null;
  /** What one member can still spend (ChoresMan balance minus reservations). */
  spendableFor: (member: PlannerMember) => number;
  renderRow: (task: PlannerTask) => React.ReactNode;
  routineRow: (routine: Routine, memberId: string) => React.ReactNode;
  /** Compact goal summary; full goal actions open the member's goals sheet. */
  renderGoals: (memberId: string) => React.ReactNode;
  goalCountFor?: (memberId: string) => number;
  copy: PlannerCopy;
  onOpenChild: (memberId: string) => void;
  onOpenGoals: (memberId: string) => void;
  onStartMissions: (memberId: string) => void;
  /** Open the missions overview (the mission screen's back destination). */
  onOpenMissions: (memberId: string) => void;
  onNewChore: (memberId?: string) => void;
  onNewRoutine?: (memberId: string) => void;
  onNewGoal: (memberId: string) => void;
}

export function ChoreBoard({
  boardMembers,
  columnTasks,
  columnRoutines,
  canRunMissions,
  freeTasks,
  claimNavigation = null,
  spendableFor,
  renderRow,
  routineRow,
  renderGoals,
  goalCountFor,
  copy: c,
  onOpenChild,
  onOpenGoals,
  onStartMissions,
  onOpenMissions,
  onNewChore,
  onNewRoutine,
  onNewGoal,
}: ChoreBoardProps) {
  /*
   * A phone cannot show four columns side by side -- they become slivers. The
   * reference app instead shows one member at a time with a tab row
   * (Doelen / Taakjes / Routines / Vrije taakjes), so the same choice is made
   * here in JS; CSS alone would mean rendering both layouts at once and
   * duplicating every row.
   */
  const phoneWidth = useMediaQuery('(max-width: 600px)');
  const shortLandscape = useMediaQuery(
    '(orientation: landscape) and (max-height: 520px) and (pointer: coarse)',
  );
  const compactLandscape = !phoneWidth && shortLandscape;
  const compact = phoneWidth || compactLandscape;
  const [activeMemberId, setActiveMemberId] = usePersistentState<string | null>(
    'abbai-flow-filter-chore-board-member',
    null,
    (value): value is string | null => value === null || typeof value === 'string',
  );
  const [tab, setTab] = usePersistentState<'chores' | 'routines' | 'goals' | 'free'>(
    'abbai-flow-filter-chore-board-tab',
    'chores',
    (value): value is 'chores' | 'routines' | 'goals' | 'free' =>
      value === 'chores' || value === 'routines' || value === 'goals' || value === 'free',
  );

  useEffect(() => {
    if (activeMemberId && boardMembers.some((member) => member.id === activeMemberId)) return;
    setActiveMemberId(boardMembers[0]?.id ?? null);
  }, [activeMemberId, boardMembers, setActiveMemberId]);

  useEffect(() => {
    if (!compact || !claimNavigation) return;
    if (!boardMembers.some((member) => member.id === claimNavigation.memberId)) return;
    setActiveMemberId(claimNavigation.memberId);
    setTab('chores');
  }, [compact, claimNavigation, boardMembers, setActiveMemberId, setTab]);

  if (compact) {
    const member = boardMembers.find((item) => item.id === activeMemberId) ?? boardMembers[0];
    const chores = member ? columnTasks(member.id) : [];
    const routines = member ? columnRoutines(member.id) : [];
    const parentMode = member?.role === 'parent';
    const activeTab = parentMode ? 'routines' : tab;
    const mobileAddAction = member
      ? activeTab === 'chores'
        ? { label: `${c.add}: ${c.choresColumn}`, run: () => onNewChore(member.id) }
        : activeTab === 'routines' && onNewRoutine
          ? { label: `${c.add}: ${c.routines}`, run: () => onNewRoutine(member.id) }
          : activeTab === 'goals'
            ? { label: `${c.add}: ${c.goals}`, run: () => onNewGoal(member.id) }
            : activeTab === 'free'
              ? { label: `${c.add}: ${c.free}`, run: () => onNewChore() }
              : null
      : null;
    const goalCount = member ? (goalCountFor?.(member.id) ?? 0) : 0;
    const visibleTabs: Array<['chores' | 'routines' | 'goals' | 'free', string, number]> =
      parentMode
        ? [['routines', c.routines, routines.length]]
        : [
            ['chores', c.choresColumn, chores.length],
            ['routines', c.routines, routines.length],
            ['goals', c.goals, goalCount],
            ['free', c.free, freeTasks.length],
          ];
    const tabIcons = {
      chores: ListChecks,
      routines: RefreshCw,
      goals: Target,
      free: Hand,
    };

    return (
      <main className="planner-board planner-board--overview planner-board--compact">
        <div className="planner-mobile-members">
          {boardMembers.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`planner-mobile-member${item.id === member?.id ? ' is-active' : ''}`}
              aria-pressed={item.id === member?.id}
              onClick={() => (compactLandscape ? onOpenChild(item.id) : setActiveMemberId(item.id))}
            >
              <span className="planner-mobile-avatar">
                <MemberAvatar member={item} />
              </span>
              <span className="planner-mobile-name">{item.name}</span>
            </button>
          ))}
        </div>

        <div className="planner-mobile-tabs" role="tablist" aria-label={c.title}>
          {visibleTabs.map(([id, label, count]) => {
            const Icon = tabIcons[id];
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-label={`${label}: ${count}`}
                aria-selected={activeTab === id}
                className={`planner-mobile-tab${activeTab === id ? ' is-active' : ''}`}
                onClick={() => setTab(id)}
              >
                <span className="planner-mobile-tab-icon" aria-hidden="true">
                  <Icon />
                  <span className="planner-mobile-tab-count">{count}</span>
                </span>
                <span className="planner-mobile-tab-label">{label}</span>
              </button>
            );
          })}
        </div>

        {member && (
          <div className="planner-mobile-actions">
            <button
              type="button"
              className="planner-ghost planner-mobile-open-child"
              onClick={() => onOpenChild(member.id)}
            >
              {c.openChild}
            </button>
            <div className="planner-mobile-action-buttons">
              {!parentMode && (
                <button
                  type="button"
                  className="planner-col-play"
                  disabled={!canRunMissions(member.id)}
                  onClick={() => onStartMissions(member.id)}
                  aria-label={`${c.startMissions}: ${member.name}`}
                >
                  {'\u25B6'}
                </button>
              )}
              {mobileAddAction && (
                <button
                  type="button"
                  className="planner-overview-add"
                  onClick={mobileAddAction.run}
                  aria-label={mobileAddAction.label}
                  title={mobileAddAction.label}
                >
                  <Plus aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        )}

        <section className="planner-col-body planner-mobile-panel">
          {activeTab === 'chores' &&
            (chores.length === 0 ? (
              <p className="planner-col-empty">{c.nothing}</p>
            ) : (
              chores.map((task) => renderRow(task))
            ))}
          {activeTab === 'routines' && (
            <>
              {/* Mission and add controls live in the toolbar above the phone
                  panel; repeating the section title and plus here wastes the
                  narrow card width. */}
              {routines.length === 0 ? (
                <p className="planner-col-empty">{c.noRoutines}</p>
              ) : (
                routines.map((routine) => routineRow(routine, member.id))
              )}
            </>
          )}
          {activeTab === 'goals' && member && renderGoals(member.id)}
          {activeTab === 'free' &&
            (freeTasks.length === 0 ? (
              <p className="planner-col-empty">{c.nothing}</p>
            ) : (
              freeTasks.map((task) => renderRow(task))
            ))}
        </section>
      </main>
    );
  }

  return (
    <main className="planner-board planner-board--overview">
      {boardMembers.map((member) => {
        const chores = columnTasks(member.id);
        const routines = columnRoutines(member.id);
        return (
          <section
            className="planner-col"
            key={member.id}
            style={{ '--member-color': member.color } as React.CSSProperties}
          >
            <header className="planner-col-head">
              <button
                type="button"
                className="planner-col-open"
                onClick={() => onOpenChild(member.id)}
                aria-label={`${c.openChild}: ${member.name}`}
              >
                <span className="planner-col-avatar">
                  <MemberAvatar member={member} />
                </span>
                <strong>{member.name}</strong>
              </button>
              {member.role !== 'parent' && (
                <button
                  type="button"
                  className="planner-col-points"
                  onClick={() => onOpenGoals(member.id)}
                  aria-label={`${c.goals}: ${member.name}`}
                >
                  <span aria-hidden="true">{'\u{1FA99}'}</span>
                  {spendableFor(member)}
                </button>
              )}
              {member.role !== 'parent' && (
                <button
                  type="button"
                  className="planner-col-play"
                  disabled={!canRunMissions(member.id)}
                  onClick={() => onStartMissions(member.id)}
                  aria-label={`${c.startMissions}: ${member.name}`}
                >
                  {'\u25B6'}
                </button>
              )}
            </header>

            <div className="planner-col-body">
              {member.role === 'parent' ? (
                <section className="planner-overview-section planner-overview-section--routines">
                  <div className="planner-overview-section-head planner-section-head--parent">
                    <h2>
                      <RefreshCw aria-hidden="true" />
                      {c.routines}
                      <span>{routines.length}</span>
                    </h2>
                    {onNewRoutine && (
                      <button
                        type="button"
                        className="planner-overview-add"
                        onClick={() => onNewRoutine(member.id)}
                        aria-label={`${c.add}: ${c.routines} ${member.name}`}
                        title={`${c.add}: ${c.routines}`}
                      >
                        <Plus aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {routines.length === 0 ? (
                    <p className="planner-col-empty">{c.noRoutines}</p>
                  ) : (
                    routines.map((routine) => routineRow(routine, member.id))
                  )}
                </section>
              ) : (
                <>
                  <section className="planner-overview-section planner-overview-section--chores">
                    <div className="planner-overview-section-head">
                      <h2>
                        <ListChecks aria-hidden="true" />
                        {c.choresColumn}
                        <span>{chores.length}</span>
                      </h2>
                      <button
                        type="button"
                        className="planner-overview-add"
                        onClick={() => onNewChore(member.id)}
                        aria-label={`${c.add}: ${c.choresColumn} ${member.name}`}
                        title={`${c.add}: ${c.choresColumn}`}
                      >
                        <Plus aria-hidden="true" />
                      </button>
                    </div>
                    {chores.length === 0 ? (
                      <p className="planner-col-empty">{c.nothing}</p>
                    ) : (
                      chores.map((task) => renderRow(task))
                    )}
                  </section>

                  <section className="planner-overview-section planner-overview-section--routines">
                    <div className="planner-overview-section-head">
                      <h2>
                        <RefreshCw aria-hidden="true" />
                        {c.routines}
                        <span>{routines.length}</span>
                      </h2>
                      <div className="planner-overview-section-actions">
                        <button
                          type="button"
                          className="planner-overview-icon-action"
                          disabled={!canRunMissions(member.id)}
                          onClick={() => onOpenMissions(member.id)}
                          aria-label={`${c.missions}: ${member.name}`}
                          title={c.missions}
                        >
                          {'\u25B6'}
                        </button>
                        {onNewRoutine && (
                          <button
                            type="button"
                            className="planner-overview-add"
                            onClick={() => onNewRoutine(member.id)}
                            aria-label={`${c.add}: ${c.routines} ${member.name}`}
                            title={`${c.add}: ${c.routines}`}
                          >
                            <Plus aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                    {routines.length === 0 ? (
                      <p className="planner-col-empty">{c.noRoutines}</p>
                    ) : (
                      routines.map((routine) => routineRow(routine, member.id))
                    )}
                  </section>

                  <section className="planner-desktop-goals planner-overview-section planner-overview-section--goals">
                    <div className="planner-overview-section-head">
                      <h2>
                        <Target aria-hidden="true" />
                        {c.goals}
                        <span>{goalCountFor?.(member.id) ?? 0}</span>
                      </h2>
                      <button
                        type="button"
                        className="planner-overview-add"
                        onClick={() => onNewGoal(member.id)}
                        aria-label={`${c.add}: ${c.goals} ${member.name}`}
                        title={`${c.add}: ${c.goals}`}
                      >
                        <Plus aria-hidden="true" />
                      </button>
                    </div>
                    {renderGoals(member.id)}
                  </section>
                </>
              )}
            </div>
          </section>
        );
      })}

      {/* Chores nobody owns yet: whoever taps one keeps it, and from then on
          it shows up in their own column. */}
      <section className="planner-col planner-col--free">
        <header className="planner-col-head">
          <span className="planner-col-avatar planner-col-avatar--free" aria-hidden="true">
            {'\u{1F450}'}
          </span>
          <strong>{c.free}</strong>
        </header>
        <div className="planner-col-body">
          <div className="planner-overview-section-head">
            <h2>
              <ListChecks aria-hidden="true" />
              {c.choresColumn}
              <span>{freeTasks.length}</span>
            </h2>
            <button
              type="button"
              className="planner-overview-add"
              onClick={() => onNewChore()}
              aria-label={`${c.add}: ${c.free}`}
              title={`${c.add}: ${c.free}`}
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
          {freeTasks.length === 0 ? (
            <p className="planner-col-empty">{c.nothing}</p>
          ) : (
            freeTasks.map((task) => renderRow(task))
          )}
        </div>
      </section>
    </main>
  );
}
