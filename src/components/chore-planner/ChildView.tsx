/**
 * One child's detail page: their goals (rewards), open chores, what they
 * finished today and their routines — the board's per-member drill-down.
 */
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import type { ChoreOpsChoreHistoryEntry } from '../../api/choreops-chore-history';
import type { PlannerMember, PlannerRoutine, PlannerTask } from '../../api/chore-planner-model';
import type { ChoreOpsReward } from '../../types/choreops';
import { MemberAvatar } from '../MemberAvatar';
import type { PlannerCopy } from './copy';

export interface ChildViewProps {
  childMember: PlannerMember;
  spendableFor: (member: PlannerMember) => number;
  columnTasks: (memberId: string) => PlannerTask[];
  columnRoutines: (memberId: string) => PlannerRoutine[];
  completedTasksFor: (memberId: string) => PlannerTask[];
  completedHistory: ChoreOpsChoreHistoryEntry[] | null;
  formatHistoryDate: (value: number) => string;
  rewardsForMember: (memberId: string) => ChoreOpsReward[];
  renderRow: (task: PlannerTask) => React.ReactNode;
  routineRow: (routine: PlannerRoutine, memberId: string) => React.ReactNode;
  renderRewardRow: (reward: ChoreOpsReward) => React.ReactNode;
  copy: PlannerCopy;
  onStepChild: (delta: number) => void;
  onStartMissions: (memberId: string) => void;
  /** Open the missions overview from the routines section. */
  onOpenMissions: (memberId: string) => void;
  /** Whether this child has anything left to run — routines, not loose chores. */
  canRunMissions: (memberId: string) => boolean;
  onNewGoal: (memberId: string) => void;
}

export function ChildView({
  childMember,
  spendableFor,
  columnTasks,
  columnRoutines,
  completedTasksFor,
  completedHistory,
  formatHistoryDate,
  rewardsForMember,
  renderRow,
  routineRow,
  renderRewardRow,
  copy: c,
  onStepChild,
  onStartMissions,
  onOpenMissions,
  canRunMissions,
  onNewGoal,
}: ChildViewProps) {
  const chores = columnTasks(childMember.id);
  const completed = completedTasksFor(childMember.id);
  const routines = columnRoutines(childMember.id);
  const rewards = rewardsForMember(childMember.id);
  const [historyRange, setHistoryRange] = useState<'twoDays' | 'week' | 'all'>('all');
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
        <span className="planner-detail-avatar">
          <MemberAvatar member={childMember} />
        </span>
        <div className="planner-detail-copy">
          <h2>{childMember.name}</h2>
          <span className="planner-detail-points">
            <span aria-hidden="true">{'\u{1FA99}'}</span>
            {spendableFor(childMember)}
          </span>
        </div>
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
        <button
          type="button"
          className="planner-col-play planner-col-play--big"
          // Missions walk routines; a child whose day is all routine steps has
          // no loose chores, and used to get a dead button.
          disabled={!canRunMissions(childMember.id)}
          onClick={() => onStartMissions(childMember.id)}
          aria-label={`${c.startMissions}: ${childMember.name}`}
        >
          {'\u25B6'}
        </button>
      </header>

      <section className="planner-detail-section">
        <h3>
          {c.goals}
          <span>{rewards.length}</span>
        </h3>
        {rewards.length === 0 && <p className="planner-col-empty">{c.noRewards}</p>}
        {rewards.map((reward) => renderRewardRow(reward))}
        <button
          className="planner-ghost planner-reward-new"
          onClick={() => onNewGoal(childMember.id)}
        >
          <Plus />
          {c.setGoal}
        </button>
      </section>

      <section className="planner-detail-section">
        <h3>
          {c.choresColumn}
          <span>{chores.length}</span>
        </h3>
        {chores.length === 0 ? (
          <p className="planner-col-empty">{c.nothing}</p>
        ) : (
          chores.map((task) => renderRow(task))
        )}
      </section>

      <section className="planner-detail-section">
        <h3>
          {c.completedHistory}
          <span>{visibleCompletions.length}</span>
        </h3>
        <label className="planner-history-filter">
          <span>{c.historyRange}</span>
          <select
            value={historyRange}
            onChange={(event) =>
              setHistoryRange(event.currentTarget.value as 'twoDays' | 'week' | 'all')
            }
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
            <article className="planner-reward planner-reward--done" key={entry.id}>
              <span aria-hidden="true">{'\u2705'}</span>
              <div className="planner-reward-copy">
                <strong>{entry.choreName}</strong>
                <small>
                  {formatHistoryDate(entry.completedAtMs)}
                  {entry.points !== null ? ` \u00b7 ${entry.points} ${c.pointsUnit}` : ''}
                </small>
              </div>
            </article>
          ))
        )}
      </section>

      <section className="planner-detail-section">
        <div className="planner-detail-section-head">
          <h3>
            {c.routines}
            <span>{routines.length}</span>
          </h3>
          <button
            type="button"
            className="planner-section-action"
            disabled={!canRunMissions(childMember.id)}
            onClick={() => onOpenMissions(childMember.id)}
          >
            {'\u25B6'} {c.missions}
          </button>
        </div>
        {routines.length === 0 ? (
          <p className="planner-col-empty">{c.noRoutines}</p>
        ) : (
          routines.map((routine) => routineRow(routine, childMember.id))
        )}
      </section>
    </main>
  );
}
