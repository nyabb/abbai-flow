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

export interface RoutineRowProps {
  routine: PlannerRoutine;
  paused: boolean;
  /** "Ochtend · dagelijks". */
  label: string;
  /** How far through its part of the day the routine is, 0–100. */
  progress: number;
  copy: PlannerCopy;
  onToggle: () => void;
}

/**
 * A routine row: name, its part of the day, progress, and a pause/resume tap.
 * A paused routine stays visible but greyed out, so a parent can see it is off
 * and bring it back with one tap.
 */
export function RoutineRow({ routine, paused, label, progress, copy, onToggle }: RoutineRowProps) {
  return (
    <div className={`planner-row planner-row--routine ${paused ? 'is-paused' : ''}`}>
      <span className="planner-row-icon" aria-hidden="true">
        {routine.icon}
      </span>
      <span className="planner-row-name">
        {routine.fallback ? copy.otherDaily : routine.name}
        <small>{paused ? copy.paused : label}</small>
      </span>
      {!paused && (
        <span className="planner-row-progress" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </span>
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
  /** The child can put something towards it right now. */
  canAdd: boolean;
  /** A claim made outside Beacon, which a parent settles in ChoreOps. */
  pending: boolean;
  saving: boolean;
  copy: PlannerCopy;
  onUndo: () => void;
  onApprove: () => void;
  onAssign: () => void;
  onMore: () => void;
}

/** A reward row: progress towards the goal plus its actions. */
export function RewardRow({
  reward,
  allocated,
  remaining,
  done,
  canAdd,
  pending,
  saving,
  copy,
  onUndo,
  onApprove,
  onAssign,
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
            ? ` \u00b7 ${copy.onHold}`
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
          <button className="planner-ghost planner-reward-action" onClick={onUndo}>
            {copy.useAgain}
          </button>
        ) : (
          <button
            className="planner-ghost planner-reward-action"
            disabled={!canAdd || saving}
            onClick={onAssign}
          >
            {copy.assign}
          </button>
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
