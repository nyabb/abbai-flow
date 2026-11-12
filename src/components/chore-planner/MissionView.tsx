/**
 * The guided "missions" run: the overview of a child's chores, the one-at-a-time
 * mission screen, and the closing celebration card.
 */
import { Check, ChevronRight } from 'lucide-react';
import type { PlannerMember, PlannerTask } from '../../api/chore-planner-model';
import type { I18nValue } from '../../i18n';
import type { PlannerCopy } from './copy';

export type MissionScreen = 'missions' | 'mission' | 'closing';

export interface MissionViewProps {
  screen: MissionScreen;
  member: PlannerMember;
  copy: PlannerCopy;
  t: I18nValue['t'];
  /** A child's open chores, already sorted. */
  openTasks: PlannerTask[];
  /** Points this child earned today. */
  completedPoints: number;
  /** Points this child can still spend. */
  spendable: number;
  currentTask: PlannerTask | null;
  currentStatus: string;
  index: number;
  total: number;
  /** The routine being worked through, and how far into it this chore is. */
  routineStep?: { name: string; index: number; total: number } | null;
  /** Seconds/time string for the current mission. */
  countdown: string;
  online: boolean;
  busy: boolean;
  renderTask: (task: PlannerTask, readOnly?: boolean) => React.ReactNode;
  onStart: () => void;
  onComplete: () => void;
  /** Parent sign-off when the current chore is waiting for review. */
  onApprove: () => void;
  onPass: () => void;
}

export function MissionView({
  screen,
  member,
  copy: c,
  t,
  openTasks,
  completedPoints,
  spendable,
  currentTask,
  currentStatus,
  index,
  total,
  routineStep,
  countdown,
  online,
  busy,
  renderTask,
  onStart,
  onComplete,
  onApprove,
  onPass,
}: MissionViewProps) {
  if (screen === 'missions') {
    return (
      <main className="planner-content planner-missions">
        <p className="planner-eyebrow">03 / 04</p>
        <h2>{c.missions}</h2>
        {openTasks.map((task) => renderTask(task, true))}
        {openTasks.length === 0 && <p className="planner-empty-copy">{c.nothing}</p>}
        <button className="planner-primary" disabled={openTasks.length === 0} onClick={onStart}>
          {c.startMissions}
          <ChevronRight />
        </button>
      </main>
    );
  }

  if (screen === 'mission' && currentTask) {
    const remaining =
      currentStatus === 'late'
        ? c.late
        : currentStatus === 'retry'
          ? c.retryCopy
          : `${c.active} ${countdown}`;
    return (
      <main className="planner-mission-screen">
        {/* Which routine this chore belongs to: the board groups by routine, so
            the run should say the same thing rather than present a bare list. */}
        {routineStep && (
          <p className="planner-mission-routine">
            {routineStep.name}
            {routineStep.total > 1 && ` \u00b7 ${routineStep.index}/${routineStep.total}`}
          </p>
        )}
        <div className="planner-mission-progress">
          <span>
            {index + 1} {t('planner.of')} {total}
          </span>
          <div>
            <i style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
        </div>
        <div className="planner-mission-hero">
          {currentTask.icon && <span>{currentTask.icon}</span>}
          <h2>{currentTask.name}</h2>
          {currentTask.points > 0 && <b>⭐ {currentTask.points}</b>}
          <p>{remaining}</p>
        </div>
        {currentTask.awaitingReview ? (
          /* The child already did their part; only a parent can finish this
             step, so the mission screen must offer the approval instead of a
             button that refuses the tap. */
          <button className="planner-primary" onClick={onApprove}>
            {c.approveCompletion}
          </button>
        ) : (
          <button className="planner-mission-done" disabled={!online || busy} onClick={onComplete}>
            {c.iDidIt}
            <Check />
          </button>
        )}
      </main>
    );
  }

  return (
    <main className="planner-today-step planner-celebrate">
      {/* Celebration card: soft glow, trophy, "{Well done, name}!" and the goal
          pill — the closing screen of the reference app. */}
      <div className="planner-celebrate-glow" aria-hidden="true">
        <span>{'\u{1F3C6}'}</span>
      </div>
      <h2 className="planner-celebrate-title">{t('planner.wellDone', { name: member.name })}</h2>
      <p className="planner-celebrate-pill">
        <span aria-hidden="true">{'\u{1F3AF}'}</span>
        {c.todayEarned}: {completedPoints}
      </p>
      <p className="planner-celebrate-sub">
        {c.pot}: {spendable}
      </p>
      <button className="planner-primary" onClick={onPass}>
        {c.pass}
      </button>
    </main>
  );
}
