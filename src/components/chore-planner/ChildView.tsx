/**
 * One child's detail page: goals above the three task columns, with chores,
 * routines, and free tasks grouped by the state that matters to the family.
 */
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Hand,
  History,
  ListChecks,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { ChoresManChoreHistoryEntry } from '../../api/choresman-history';
import type { PlannerMember, PlannerTask, PlannerTaskStatus } from '../../api/chore-planner-model';
import type { ChoresManReward } from '../../types/choresman';
import type { Routine } from '../../types/family';
import { MemberAvatar } from '../MemberAvatar';
import type { PlannerCopy } from './copy';
import { usePersistentState } from '../../hooks/usePersistentState';

type HistoryRange = 'twoDays' | 'week' | 'all';
type RoutineStatus = 'active' | 'planned' | 'late' | 'done';

function isHistoryRange(value: unknown): value is HistoryRange {
  return value === 'twoDays' || value === 'week' || value === 'all';
}

function StatusGroup({
  label,
  count,
  tone,
  initiallyOpen = false,
  children,
}: {
  label: string;
  count: number;
  tone: 'chores' | 'routines' | 'free' | 'done' | 'late' | 'planned' | 'expired';
  initiallyOpen?: boolean;
  children: React.ReactNode;
}) {
  if (count === 0) return null;

  return (
    <details
      className={`planner-detail-status planner-detail-status--${tone}`}
      open={initiallyOpen}
    >
      <summary>
        <span>
          {label} ({count})
        </span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="planner-detail-status-items">{children}</div>
    </details>
  );
}

export interface ChildViewProps {
  childMember: PlannerMember;
  isParent: boolean;
  spendableFor: (member: PlannerMember) => number;
  columnTasks: (memberId: string) => PlannerTask[];
  freeTasks: PlannerTask[];
  columnRoutines: (memberId: string) => Routine[];
  completedTasksFor: (memberId: string) => PlannerTask[];
  taskStatus: (task: PlannerTask) => PlannerTaskStatus;
  routineStatus: (routine: Routine, memberId: string) => RoutineStatus;
  completedHistory: ChoresManChoreHistoryEntry[] | null;
  formatHistoryDate: (value: number) => string;
  rewardsForMember: (memberId: string) => ChoresManReward[];
  renderTask: (task: PlannerTask, claimMemberId?: string) => React.ReactNode;
  routineRow: (routine: Routine, memberId: string) => React.ReactNode;
  renderRewardRow: (reward: ChoresManReward) => React.ReactNode;
  copy: PlannerCopy;
  onStepChild: (delta: number) => void;
  onStartMissions: (memberId: string) => void;
  /** Whether this child has anything left to run — routines, not loose chores. */
  canRunMissions: (memberId: string) => boolean;
  onNewChore: (memberId: string) => void;
  onNewFreeTask: () => void;
  onNewGoal: (memberId: string) => void;
  onOpenRewardHistory: (memberId: string) => void;
  onNewRoutine?: (memberId: string) => void;
}

export function ChildView({
  childMember,
  isParent,
  spendableFor,
  columnTasks,
  freeTasks,
  columnRoutines,
  completedTasksFor,
  taskStatus,
  routineStatus,
  completedHistory,
  formatHistoryDate,
  rewardsForMember,
  renderTask,
  routineRow,
  renderRewardRow,
  copy: c,
  onStepChild,
  onStartMissions,
  canRunMissions,
  onNewChore,
  onNewFreeTask,
  onNewGoal,
  onOpenRewardHistory,
  onNewRoutine,
}: ChildViewProps) {
  const openChores = columnTasks(childMember.id);
  const completed = completedTasksFor(childMember.id);
  const routines = columnRoutines(childMember.id);
  const rewards = rewardsForMember(childMember.id);
  const chores = [...openChores, ...completed.filter((task) => task.audience !== 'anyone')].filter(
    (task, index, all) => all.findIndex((other) => other.id === task.id) === index,
  );
  const choreTodo = chores.filter((task) => taskStatus(task) === 'active');
  const chorePlanned = chores.filter((task) => taskStatus(task) === 'upcoming');
  const choreLate = chores.filter((task) => ['late', 'retry'].includes(taskStatus(task)));
  const freeTodo = freeTasks.filter((task) => ['active', 'retry'].includes(taskStatus(task)));
  const freePlanned = freeTasks.filter((task) => taskStatus(task) === 'upcoming');
  const freeLate = freeTasks.filter((task) => taskStatus(task) === 'late');
  const freeExpired = freeTasks.filter((task) => taskStatus(task) === 'expired');
  const routineGroups: Array<[RoutineStatus, string]> = [
    ['active', c.openTodo],
    ['planned', c.upcoming],
    ['late', c.late],
    ['done', c.done],
  ];
  const [historyRange, setHistoryRange] = usePersistentState(
    'abbai-flow-filter-chore-history-range',
    'week',
    isHistoryRange,
  );
  const currentCompletions = completed.flatMap((task) => {
    const completedAtMs = task.completedAt ? Date.parse(task.completedAt) : Number.NaN;
    if (!Number.isFinite(completedAtMs)) return [];
    return [
      {
        id: `current:${task.id}:${completedAtMs}`,
        choreName: task.name,
        completedAtMs,
        points: task.points,
      },
    ];
  });
  const recordedCompletions = completedHistory ?? [];
  const recentFallbacks = currentCompletions.filter(
    (current) =>
      !recordedCompletions.some(
        (recorded) =>
          current.choreName.trim().toLocaleLowerCase() ===
            recorded.choreName.trim().toLocaleLowerCase() &&
          Math.abs(current.completedAtMs - recorded.completedAtMs) < 15 * 60_000,
      ),
  );
  const allCompletions = [...recordedCompletions, ...recentFallbacks].sort(
    (left, right) => right.completedAtMs - left.completedAtMs,
  );
  const rangeStart =
    historyRange === 'twoDays'
      ? Date.now() - 2 * 24 * 60 * 60 * 1000
      : historyRange === 'week'
        ? Date.now() - 7 * 24 * 60 * 60 * 1000
        : null;
  const visibleCompletions =
    rangeStart === null
      ? allCompletions
      : allCompletions.filter((entry) => entry.completedAtMs >= rangeStart);

  return (
    <main className="planner-detail">
      <header className="planner-detail-hero">
        <div className="planner-detail-toolbar">
          <div className="planner-detail-nav">
            <button
              type="button"
              className="planner-icon-button"
              onClick={() => onStepChild(-1)}
              aria-label={c.prevChild}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              className="planner-icon-button"
              onClick={() => onStepChild(1)}
              aria-label={c.nextChild}
            >
              <ChevronRight />
            </button>
          </div>
        </div>

        <div className="planner-detail-overview">
          <div className="planner-detail-profile">
            <span className="planner-detail-avatar">
              <MemberAvatar member={childMember} />
            </span>
            <div className="planner-detail-copy">
              <h2>{childMember.name}</h2>
              {!isParent && (
                <span className="planner-detail-points">
                  <span aria-hidden="true">{'\u{1FA99}'}</span>
                  {spendableFor(childMember)}
                </span>
              )}
            </div>
            {!isParent && (
              <button
                type="button"
                className="planner-col-play planner-col-play--big"
                disabled={!canRunMissions(childMember.id)}
                onClick={() => onStartMissions(childMember.id)}
                aria-label={`${c.startMissions}: ${childMember.name}`}
              >
                {'\u25B6'}
              </button>
            )}
          </div>

          {!isParent && (
            <section className="planner-detail-goals">
              <div className="planner-detail-goals-head">
                <h3>{c.goals}</h3>
                <div className="planner-detail-goal-actions">
                  <button
                    type="button"
                    className="planner-detail-goal-history"
                    onClick={() => onOpenRewardHistory(childMember.id)}
                    aria-label={c.rewardHistory}
                    title={c.rewardHistory}
                  >
                    <History aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="planner-detail-goal-add"
                    onClick={() => onNewGoal(childMember.id)}
                    aria-label={c.setGoal}
                    title={c.setGoal}
                  >
                    <Plus aria-hidden="true" />
                  </button>
                </div>
              </div>
              {rewards.length === 0 ? (
                <p className="planner-detail-goals-empty">{c.noRewards}</p>
              ) : (
                <div className="planner-detail-goal-list">
                  {rewards.map((reward) => renderRewardRow(reward))}
                </div>
              )}
            </section>
          )}
        </div>
      </header>

      <div
        className={`planner-detail-columns${isParent ? ' planner-detail-columns--parent' : ''}`}
      >
        {!isParent && (
          <section className="planner-detail-section planner-detail-section--chores">
            <div className="planner-detail-section-head">
              <h3>
                <ListChecks aria-hidden="true" />
                {c.choresColumn}
              </h3>
              <button
                type="button"
                className="planner-detail-add"
                onClick={() => onNewChore(childMember.id)}
                aria-label={`${c.add}: ${c.choresColumn}`}
                title={`${c.add}: ${c.choresColumn}`}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
            <div className="planner-detail-status-list">
              <StatusGroup
                label={c.openTodo}
                count={choreTodo.length}
                tone="chores"
                initiallyOpen
              >
                {choreTodo.map((task) => renderTask(task))}
              </StatusGroup>
              <StatusGroup label={c.upcoming} count={chorePlanned.length} tone="planned">
                {chorePlanned.map((task) => renderTask(task))}
              </StatusGroup>
              <StatusGroup label={c.late} count={choreLate.length} tone="late">
                {choreLate.map((task) => renderTask(task))}
              </StatusGroup>
              <StatusGroup label={c.done} count={visibleCompletions.length} tone="done">
                <label className="planner-detail-history-filter">
                  <span>{c.historyRange}</span>
                  <select
                    value={historyRange}
                    onChange={(event) => setHistoryRange(event.currentTarget.value as HistoryRange)}
                  >
                    <option value="twoDays">{c.historyLastTwoDays}</option>
                    <option value="week">{c.historyLastWeek}</option>
                    <option value="all">{c.historyAllTime}</option>
                  </select>
                </label>
                {visibleCompletions.length === 0 ? (
                  <p className="planner-col-empty">{c.historyEmpty}</p>
                ) : (
                  visibleCompletions.map((entry) => (
                    <article
                      className="planner-task planner-task--completed planner-detail-history-card"
                      key={entry.id}
                      aria-label={`${entry.choreName}, ${c.done}, ${formatHistoryDate(entry.completedAtMs)}`}
                    >
                      <div className="planner-task-copy">
                        <div className="planner-task-title-row">
                          <span className="planner-task-icon" aria-hidden="true">
                            <Check />
                          </span>
                          <h3>{entry.choreName}</h3>
                        </div>
                        <p>{formatHistoryDate(entry.completedAtMs)}</p>
                      </div>
                      <div
                        className="planner-check planner-check--static is-checked"
                        aria-hidden="true"
                      >
                        <span className="planner-check-label">{c.done}</span>
                        {entry.points !== null && (
                          <span className="planner-check-points">
                            <span>{'\u{1F3C6}'}</span>
                            {entry.points} {c.pointsUnit}
                          </span>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </StatusGroup>
            </div>
            {chores.length === 0 && visibleCompletions.length === 0 && (
              <p className="planner-col-empty">{c.nothing}</p>
            )}
          </section>
        )}

        <section className="planner-detail-section planner-detail-section--routines">
          <div className="planner-detail-section-head">
            <h3>
              <RefreshCw aria-hidden="true" />
              {c.routines}
            </h3>
            {onNewRoutine && (
              <button
                type="button"
                className="planner-detail-add"
                onClick={() => onNewRoutine(childMember.id)}
                aria-label={`${c.add}: ${c.routines}`}
                title={`${c.add}: ${c.routines}`}
              >
                <Plus aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="planner-detail-status-list">
            {routineGroups.map(([status, label]) => {
              const group = routines.filter(
                (routine) => routineStatus(routine, childMember.id) === status,
              );
              return (
                <StatusGroup
                  key={status}
                  label={label}
                  count={group.length}
                  tone={status === 'active' ? 'routines' : status === 'done' ? 'done' : status}
                  initiallyOpen={status === 'active'}
                >
                  {group.map((routine) => routineRow(routine, childMember.id))}
                </StatusGroup>
              );
            })}
          </div>
          {routines.length === 0 && <p className="planner-col-empty">{c.noRoutines}</p>}
        </section>

        {!isParent && (
          <section className="planner-detail-section planner-detail-section--free">
            <div className="planner-detail-section-head">
              <h3><Hand aria-hidden="true" />{c.free}</h3>
              <button
                type="button"
                className="planner-detail-add"
                onClick={onNewFreeTask}
                aria-label={`${c.add}: ${c.free}`}
                title={`${c.add}: ${c.free}`}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
            <div className="planner-detail-status-list">
              <StatusGroup
                label={c.openTodo}
                count={freeTodo.length}
                tone="free"
                initiallyOpen
              >
                {freeTodo.map((task) => renderTask(task, childMember.id))}
              </StatusGroup>
              <StatusGroup label={c.upcoming} count={freePlanned.length} tone="planned">
                {freePlanned.map((task) => renderTask(task, childMember.id))}
              </StatusGroup>
              <StatusGroup label={c.late} count={freeLate.length} tone="late">
                {freeLate.map((task) => renderTask(task, childMember.id))}
              </StatusGroup>
              <StatusGroup label={c.expired} count={freeExpired.length} tone="expired">
                {freeExpired.map((task) => renderTask(task, childMember.id))}
              </StatusGroup>
            </div>
            {freeTasks.length === 0 && <p className="planner-col-empty">{c.nothing}</p>}
          </section>
        )}
      </div>
    </main>
  );
}
