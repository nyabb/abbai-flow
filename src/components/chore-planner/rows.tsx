/**
 * Presentational rows for the planner board.
 *
 * These were inline `render…` helpers inside the planner component. They only
 * need the data they display and the callbacks for their buttons, so they live
 * separately: the board decides *what* to show, these decide *how* it looks.
 */
import { Check } from 'lucide-react';
import type { PlannerRoutine, PlannerTask } from '../../api/chore-planner-model';
import type { ChoreOpsReward } from '../../types/choreops';
import type { PlannerCopy } from './copy';

export interface TaskRowProps {
  task: PlannerTask;
  status: string;
  /** A tap on this row is already in flight. */
  busy: boolean;
  online: boolean;
  copy: PlannerCopy;
  /** Secondary line under the name, or `null` for a quiet one-line row. */
  hint: string | null;
  /** Accessible name for the round button: the action the tap performs. */
  actionLabel: string;
  onPrimary: () => void;
  onMore: () => void;
}

/** One chore on the board: status button, name, points, actions. */
export function TaskRow({
  task,
  status,
  busy,
  online,
  copy,
  hint,
  actionLabel,
  onPrimary,
  onMore,
}: TaskRowProps) {
  return (
    <div
      className={`planner-row planner-row--${status}${
        task.audience === 'anyone' ? ' planner-row--anyone' : ''
      }`}
    >
      <button
        type="button"
        className={`planner-row-check ${status === 'completed' ? 'is-done' : ''}`}
        aria-label={`${actionLabel}: ${task.name}`}
        disabled={!online || status === 'upcoming' || busy}
        onClick={onPrimary}
      >
        {busy ? (
          <span className="planner-spinner" />
        ) : status === 'completed' ? (
          <Check />
        ) : task.audience === 'anyone' ? (
          <span aria-hidden="true">{'\u270B'}</span>
        ) : null}
      </button>
      <span className="planner-row-name">
        {task.name}
        {hint && <small>{hint}</small>}
      </span>
      {task.points > 0 && (
        <span className="planner-row-points">
          <span aria-hidden="true">{'\u{1F3C6}'}</span>
          {task.points}
        </span>
      )}
      <button
        type="button"
        className="planner-row-more"
        aria-label={`${copy.action}: ${task.name}`}
        onClick={onMore}
      >
        {'\u22ef'}
      </button>
    </div>
  );
}

/** One step of a routine, as it stands for one child today. */
export interface RoutineStep {
  name: string;
  /** Already ticked off today. */
  done: boolean;
  /** Still waiting to be done. */
  open: boolean;
  /** The child finished it and a parent still has to sign it off. */
  awaiting?: boolean;
}

export interface RoutineRowProps {
  routine: PlannerRoutine;
  paused: boolean;
  /** "Ochtend · dagelijks". */
  label: string;
  /** How far through its part of the day the routine is, 0–100. */
  progress: number;
  /** The routine's steps for the child whose column this is. */
  steps?: RoutineStep[];
  copy: PlannerCopy;
  onToggle: () => void;
  /** Start this routine as a mission for that child. */
  onStart?: () => void;
  /** There is something left to run, so starting makes sense. */
  canStart?: boolean;
  /** Parent sign-off for a step that is waiting for review (PIN-gated by the caller). */
  onApproveStep?: (stepName: string) => void;
}

/**
 * A routine row: name, its part of the day, how far through the day it is, the
 * steps it contains and which of them are already done.
 *
 * The steps are the point: a parent looking at a child needs to see "three of
 * five done" without opening anything else, and the child needs to see which
 * two are left. A paused routine stays visible but greyed out, so a parent can
 * see it is off and bring it back with one tap.
 */
export function RoutineRow({
  routine,
  paused,
  label,
  progress,
  steps = [],
  copy,
  onToggle,
  onStart,
  canStart = false,
  onApproveStep,
}: RoutineRowProps) {
  const doneCount = steps.filter((step) => step.done).length;
  /* The bar sits next to "3/3", so it must track steps done. The time-of-day
     progress is only a fallback for a routine that has no steps yet. */
  const stepProgress = steps.length > 0 ? (doneCount / steps.length) * 100 : progress;

  return (
    <div className={`planner-row planner-row--routine ${paused ? 'is-paused' : ''}`}>
      <div className="planner-routine-head">
        <span className="planner-row-icon" aria-hidden="true">
          {routine.icon}
        </span>
        <span className="planner-row-name">
          {routine.fallback ? copy.otherDaily : routine.name}
          <small>{paused ? copy.paused : label}</small>
        </span>
        {steps.length > 0 && (
          <span className="planner-routine-count" aria-label={`${doneCount}/${steps.length}`}>
            {doneCount}/{steps.length}
          </span>
        )}
        {!paused && (
          <span className="planner-row-progress" aria-hidden="true">
            <i style={{ width: `${stepProgress}%` }} />
          </span>
        )}
        {onStart && (
          <button
            type="button"
            className="planner-row-more planner-row-start"
            disabled={!canStart || paused}
            aria-label={`${copy.startRoutine}: ${routine.name}`}
            onClick={onStart}
          >
            {'\u25B6'}
          </button>
        )}
        <button
          type="button"
          className="planner-row-more"
          aria-label={`${paused ? copy.resumeRoutine : copy.pauseRoutine}: ${routine.name}`}
          onClick={onToggle}
        >
          {paused ? '\u25B6' : '\u23F8'}
        </button>
      </div>
      {steps.length > 0 && (
        <ul className="planner-steps">
          {steps.map((step) => (
            <li
              key={step.name}
              className={`planner-step${step.done ? ' is-done' : ''}${
                !step.done && !step.open ? ' is-idle' : ''
              }`}
            >
              <span className="planner-step-mark" aria-hidden="true">
                {step.done ? '\u2713' : '\u25CB'}
              </span>
              <span className="planner-step-name">{step.name}</span>
              {step.awaiting && onApproveStep && (
                <button
                  type="button"
                  className="planner-approve planner-step-approve"
                  onClick={() => onApproveStep(step.name)}
                >
                  {copy.approveCompletion}
                </button>
              )}
              <span className="planner-sr-only">{step.done ? copy.done : copy.openTodo}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface RewardRowProps {
  reward: ChoreOpsReward;
  /** Points put aside towards this reward so far. */
  allocated: number;
  /** What is still missing before the cost is covered. */
  remaining: number;
  /** The full cost is set aside: the reward is on hold and belongs under Done. */
  done: boolean;
  /** A claim made outside Abbai Flow, which a parent settles in ChoreOps. */
  pending: boolean;
  /** There are unallocated points available for this reward. */
  canAdd: boolean;
  copy: PlannerCopy;
  onUndo: () => void;
  onAssign: () => void;
  onApprove: () => void;
  /** Parent-only: hand the fully funded reward over (PIN-gated by the caller). */
  onGive: () => void;
  onMore: () => void;
}

/** A reward row: progress towards the goal plus its actions. */
export function RewardRow({
  reward,
  allocated,
  remaining,
  done,
  pending,
  canAdd,
  copy,
  onUndo,
  onAssign,
  onApprove,
  onGive,
  onMore,
}: RewardRowProps) {
  /* The bar tracks what has been set aside for this reward, not the child's
     whole balance -- the old reading made every goal look nearly reachable. */
  const progress = done ? 100 : Math.min(100, (allocated / Math.max(1, reward.cost)) * 100);

  return (
    <div className={`planner-reward${done ? ' planner-reward--done' : ''}`}>
      <span aria-hidden="true">{'\u{1F381}'}</span>
      <div className="planner-reward-copy">
        <strong>{reward.name}</strong>
        <small>
          {`${allocated} / ${reward.cost} ${copy.pointsUnit}`}
          {done
            ? ` \u00b7 ${copy.goalAchieved} \u00b7 ${copy.waitingForReward}`
            : ` \u00b7 ${copy.stillNeeded.replace('{points}', String(remaining))}`}
          {pending ? ` \u00b7 ${copy.claimed}` : ''}
        </small>
        <i>
          <b style={{ width: `${progress}%` }} />
        </i>
      </div>
      <div className="planner-reward-actions">
        {pending ? (
          <button className="planner-primary planner-reward-action" onClick={onApprove}>
            {copy.confirm}
          </button>
        ) : done ? (
          /* Goal reached: the child cannot add more. The payout is the parent's
             approval, so the action sits on the row itself instead of only in
             the "rewards to give" queue. */
          <>
            <span className="planner-hint">{copy.waitingForReward}</span>
            <button className="planner-primary planner-reward-action" onClick={onGive}>
              {copy.approvePayout}
            </button>
          </>
        ) : (
          /* Allow points already sitting in the savings pot to be allocated
             later, as well as from the award sheet after a chore is ticked. */
          <>
            {canAdd && (
              <button
                type="button"
                className="planner-primary planner-reward-action"
                onClick={onAssign}
              >
                {copy.assign}
              </button>
            )}
            {allocated > 0 && (
              <button className="planner-ghost planner-reward-action" onClick={onUndo}>
                {copy.undoShort}
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="planner-task-more"
          aria-label={`${copy.action}: ${reward.name}`}
          onClick={onMore}
        >
          {'\u22ef'}
        </button>
      </div>
    </div>
  );
}
