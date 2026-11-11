/**
 * The board screen: one column per family member plus the column of chores
 * nobody owns yet.
 *
 * It renders only what the planner hands it (already filtered tasks, routines
 * and row renderers), so the board has no ChoreOps knowledge of its own.
 */
import { useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { PlannerMember, PlannerRoutine, PlannerTask } from '../../api/chore-planner-model';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MemberAvatar } from '../MemberAvatar';
import type { PlannerCopy } from './copy';

export interface ChoreBoardProps {
  /** Members a parent has not filtered out. */
  boardMembers: PlannerMember[];
  /** Open chores of one member, late first. */
  columnTasks: (memberId: string) => PlannerTask[];
  /** Routines that belong to one member. */
  columnRoutines: (memberId: string) => PlannerRoutine[];
  /** Whether the child has anything left to run (routines, not loose chores). */
  canRunMissions: (memberId: string) => boolean;
  /** Chores still up for grabs, deduplicated by name. */
  freeTasks: PlannerTask[];
  /** What one member can still spend (ChoreOps balance minus reservations). */
  spendableFor: (member: PlannerMember) => number;
  renderRow: (task: PlannerTask) => React.ReactNode;
  routineRow: (routine: PlannerRoutine, memberId: string) => React.ReactNode;
  /** A member's goals, rendered inline in the phone layout's Doelen tab. */
  renderGoals: (memberId: string) => React.ReactNode;
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
  canRunMissions,
  freeTasks,
  spendableFor,
  renderRow,
  routineRow,
  renderGoals,
  copy: c,
  onOpenChild,
  onOpenGoals,
  onStartMissions,
  onNewChore,
}: ChoreBoardProps) {
  /*
   * A phone cannot show four columns side by side -- they become slivers. The
   * reference app instead shows one member at a time with a tab row
   * (Doelen / Taakjes / Routines / Vrije taakjes), so the same choice is made
   * here in JS; CSS alone would mean rendering both layouts at once and
   * duplicating every row.
   */
  const compact = useMediaQuery('(max-width: 600px)');
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [tab, setTab] = useState<'chores' | 'routines' | 'goals' | 'free'>('chores');

  if (compact) {
    const member = boardMembers.find((item) => item.id === activeMemberId) ?? boardMembers[0];
    const chores = member ? columnTasks(member.id) : [];
    const routines = member ? columnRoutines(member.id) : [];

    return (
      <main className="planner-board planner-board--compact">
        <div className="planner-mobile-members">
          {boardMembers.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`planner-mobile-member${item.id === member?.id ? ' is-active' : ''}`}
              aria-pressed={item.id === member?.id}
              onClick={() => setActiveMemberId(item.id)}
            >
              <span className="planner-mobile-avatar">
                <MemberAvatar member={item} />
              </span>
              <span className="planner-mobile-name">{item.name}</span>
            </button>
          ))}
        </div>

        <div className="planner-mobile-tabs" role="tablist" aria-label={c.title}>
          {(
            [
              ['chores', c.choresColumn, chores.length],
              ['routines', c.routines, routines.length],
              ['goals', c.goals, null],
              ['free', c.free, freeTasks.length],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`planner-mobile-tab${tab === id ? ' is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
              {count !== null && <span>{count}</span>}
            </button>
          ))}
        </div>

        {member && (
          <div className="planner-mobile-actions">
            <button
              type="button"
              className="planner-ghost planner-mobile-open-child"
              onClick={() => onOpenChild(member.id)}
            >
              <ChevronRight aria-hidden="true" />
              {c.openChild}
            </button>
            <button
              type="button"
              className="planner-col-play"
              disabled={!canRunMissions(member.id)}
              onClick={() => onStartMissions(member.id)}
              aria-label={`${c.startMissions}: ${member.name}`}
            >
              {'\u25B6'}
            </button>
          </div>
        )}

        <section className="planner-col-body planner-mobile-panel">
          {tab === 'chores' &&
            (chores.length === 0 ? (
              <p className="planner-col-empty">{c.nothing}</p>
            ) : (
              chores.map((task) => renderRow(task))
            ))}
          {tab === 'routines' &&
            (routines.length === 0 ? (
              <p className="planner-col-empty">{c.noRoutines}</p>
            ) : (
              routines.map((routine) => routineRow(routine, member.id))
            ))}
          {tab === 'goals' && member && renderGoals(member.id)}
          {tab === 'free' &&
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
                disabled={!canRunMissions(member.id)}
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
                routines.map((routine) => routineRow(routine, member.id))
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
