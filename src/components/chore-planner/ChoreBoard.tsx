/**
 * The board screen: one column per family member plus the column of chores
 * nobody owns yet.
 *
 * It renders only what the planner hands it (already filtered tasks, routines
 * and row renderers), so the board has no ChoreOps knowledge of its own.
 */
import { Plus } from 'lucide-react';
import type { PlannerMember, PlannerRoutine, PlannerTask } from '../../api/chore-planner-model';
import { MemberAvatar } from '../MemberAvatar';
import type { PlannerCopy } from './copy';

export interface ChoreBoardProps {
  /** Members a parent has not filtered out. */
  boardMembers: PlannerMember[];
  /** Open chores of one member, late first. */
  columnTasks: (memberId: string) => PlannerTask[];
  /** Routines that belong to one member. */
  columnRoutines: (memberId: string) => PlannerRoutine[];
  /** Chores still up for grabs, deduplicated by name. */
  freeTasks: PlannerTask[];
  /** What one member can still spend (ChoreOps balance minus reservations). */
  spendableFor: (member: PlannerMember) => number;
  renderRow: (task: PlannerTask) => React.ReactNode;
  routineRow: (routine: PlannerRoutine) => React.ReactNode;
  copy: PlannerCopy;
  onOpenChild: (memberId: string) => void;
  onOpenGoals: (memberId: string) => void;
  onStartMissions: (memberId: string) => void;
  onNewChore: () => void;
}

export function ChoreBoard({
  boardMembers,
  columnTasks,
  columnRoutines,
  freeTasks,
  spendableFor,
  renderRow,
  routineRow,
  copy: c,
  onOpenChild,
  onOpenGoals,
  onStartMissions,
  onNewChore,
}: ChoreBoardProps) {
  return (
    <main className="planner-board">
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
              <button
                type="button"
                className="planner-col-points"
                onClick={() => onOpenGoals(member.id)}
                aria-label={`${c.goals}: ${member.name}`}
              >
                <span aria-hidden="true">{'\u{1FA99}'}</span>
                {spendableFor(member)}
              </button>
              <button
                type="button"
                className="planner-col-play"
                disabled={chores.length === 0}
                onClick={() => onStartMissions(member.id)}
                aria-label={`${c.startMissions}: ${member.name}`}
              >
                {'\u25B6'}
              </button>
            </header>

            <div className="planner-col-body">
              <h2>
                {c.choresColumn}
                <span>{chores.length}</span>
              </h2>
              {chores.length === 0 ? (
                <p className="planner-col-empty">{c.nothing}</p>
              ) : (
                chores.map((task) => renderRow(task))
              )}

              <h2>
                {c.routines}
                <span>{routines.length}</span>
              </h2>
              {routines.length === 0 ? (
                <p className="planner-col-empty">{c.noRoutines}</p>
              ) : (
                routines.map((routine) => routineRow(routine))
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
          <h2>
            {c.choresColumn}
            <span>{freeTasks.length}</span>
          </h2>
          {freeTasks.length === 0 ? (
            <p className="planner-col-empty">{c.nothing}</p>
          ) : (
            freeTasks.map((task) => renderRow(task))
          )}
        </div>
        <button
          type="button"
          className="planner-col-start planner-col-start--ghost"
          onClick={onNewChore}
        >
          <Plus />
          {c.add}
        </button>
      </section>
    </main>
  );
}
