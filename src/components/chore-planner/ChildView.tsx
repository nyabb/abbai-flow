/**
 * One child's detail page: their goals (rewards), open chores, what they
 * finished today and their routines — the board's per-member drill-down.
 */
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
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
  rewardsForMember: (memberId: string) => ChoreOpsReward[];
  renderRow: (task: PlannerTask) => React.ReactNode;
  routineRow: (routine: PlannerRoutine, memberId: string) => React.ReactNode;
  renderRewardRow: (reward: ChoreOpsReward) => React.ReactNode;
  copy: PlannerCopy;
  onStepChild: (delta: number) => void;
  onStartMissions: (memberId: string) => void;
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
  rewardsForMember,
  renderRow,
  routineRow,
  renderRewardRow,
  copy: c,
  onStepChild,
  onStartMissions,
  canRunMissions,
  onNewGoal,
}: ChildViewProps) {
  const chores = columnTasks(childMember.id);
  const completed = completedTasksFor(childMember.id);
  const routines = columnRoutines(childMember.id);
  const rewards = rewardsForMember(childMember.id);

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
          {c.done}
          <span>{completed.length}</span>
        </h3>
        {completed.length === 0 ? (
          <p className="planner-col-empty">{c.nothing}</p>
        ) : (
          completed.map((task) => renderRow(task))
        )}
      </section>

      <section className="planner-detail-section">
        <h3>
          {c.routines}
          <span>{routines.length}</span>
        </h3>
        {routines.length === 0 ? (
          <p className="planner-col-empty">{c.noRoutines}</p>
        ) : (
          routines.map((routine) => routineRow(routine, childMember.id))
        )}
      </section>
    </main>
  );
}
