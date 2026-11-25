import { useState, useEffect, useMemo, useRef, CSSProperties } from 'react';
import { format } from 'date-fns';
import { useFamily } from '../../hooks/useFamily';
import { useChoresMan } from '../../hooks/useChoresMan';
import { findUserForMember } from '../../api/chore-model';
import { choreIconForDisplay } from '../../api/chore-planner-view';
import { MemberAvatar } from '../MemberAvatar';
import { useRoutines } from '../../hooks/useRoutines';
import { AbbaiSettings } from '../../hooks/useSettings';
import { ScreenSaver } from '../ScreenSaver';
import { useTranslation } from '../../i18n';
import { RoutineCard } from './RoutineCard';
import { RoutineEditorDialog } from '../routines/RoutineEditorDialog';
import type { RoutineEditorRequest } from '../routines/RoutineEditorDialog';
import { FocusChores } from './FocusChores';
import { pickRoutines, getTimeOfDay } from './period';
import { ActivitySpinner, LoadingPlaceholder } from '../LoadingPlaceholder';

interface FocusViewProps {
  memberId: string;
  settings: AbbaiSettings;
  onExit: () => void;
}

const GREETINGS = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
} as const;

export function FocusView({ memberId, settings, onExit }: FocusViewProps) {
  const { members } = useFamily();
  const routinesApi = useRoutines(memberId);
  const choresMan = useChoresMan(members);
  const { t } = useTranslation();
  const [routineEditorRequest, setRoutineEditorRequest] = useState<RoutineEditorRequest | null>(
    null,
  );

  const member = members.find((m) => m.id === memberId);

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Periodic data refresh so a wall display picks up edits made elsewhere
  const { refresh: refreshRoutines } = routinesApi;
  const { refresh: refreshChores } = choresMan;
  useEffect(() => {
    const t = setInterval(
      () => {
        refreshRoutines();
        refreshChores();
      },
      5 * 60 * 1000,
    );
    return () => clearInterval(t);
  }, [refreshRoutines, refreshChores]);

  // Exit gesture: 5 taps on the clock within 3 seconds
  const taps = useRef<number[]>([]);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  /**
   * Chore tapped on the board, waiting for "are you sure?" — a mis-tap on a
   * wall display would otherwise claim someone else's chore and pay out points.
   */
  const [confirmChoreId, setConfirmChoreId] = useState<string | null>(null);
  const [pendingChoreId, setPendingChoreId] = useState<string | null>(null);
  const [celebration, setCelebration] = useState(false);
  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(false), 2100);
    return () => clearTimeout(timer);
  }, [celebration]);
  const handleClockTap = () => {
    const timestamp = Date.now();
    taps.current = [...taps.current.filter((prev) => timestamp - prev < 3000), timestamp];
    if (taps.current.length >= 5) {
      taps.current = [];
      setShowExitConfirm(true);
    }
  };

  // ChoresMan owns chore data: resolve this member's record, then take
  // the chores ChoresMan assigns to them.
  const choresManUser = useMemo(
    () => member ? findUserForMember(member, choresMan.data?.users ?? []) : null,
    [member, choresMan.data],
  );

  const memberChores = useMemo(() => {
    const assignee = choresManUser?.name.trim().toLowerCase();
    if (!assignee) return [];

    return (choresMan.data?.chores ?? [])
      .filter((chore) => chore.assignee?.trim().toLowerCase() === assignee)
      .map((chore) => ({
        id: chore.id,
        name: chore.name,
        assigned_to: [memberId],
        frequency: 'once' as const,
        value_cents: 0,
        icon: choreIconForDisplay(chore.icon) ?? undefined,
      }));
  }, [choresMan.data, choresManUser, memberId]);

  const completedChoreIds = useMemo(() => {
    const ids = new Set<string>();
    for (const chore of choresMan.data?.chores ?? []) {
      if (/^(approved|completed|done)/i.test(chore.status)) ids.add(chore.id);
    }
    return ids;
  }, [choresMan.data]);

  const picks = pickRoutines(routinesApi.routines, now);

  if (!member) {
    // Member deleted while display active: App-level guard exits on next render
    return null;
  }

  const currentPicks = picks.filter((pick) => pick.isCurrent);
  const currentRoutineTasks = currentPicks.flatMap((pick) => pick.routine.tasks);
  const routineDone = currentPicks.every((pick) =>
    pick.routine.tasks.every((task) =>
      routinesApi.isTaskCompletedToday(pick.routine.id, task.id, memberId),
    ),
  );
  const choresDone = memberChores.every((c) => completedChoreIds.has(c.id));
  const hadItems = currentRoutineTasks.length + memberChores.length > 0;
  const allDone = hadItems && routineDone && choresDone;

  /** The chore waiting for confirmation, plus whether it is a sign-off. */
  const confirmChore = memberChores.find((chore) => chore.id === confirmChoreId) ?? null;
  const confirmIsDone = /(claim|review|progress|submit)/i.test(
    choresMan.data?.chores.find((chore) => chore.id === confirmChoreId)?.status ?? '',
  );

  return (
    <div
      className={`focus-view ${settings.reducedMotion ? 'focus-view--reduce-motion' : ''}`}
      style={{ '--focus-accent': member.color } as CSSProperties}
    >
      <header className="focus-header">
        <div className="focus-member">
          <span
            className="focus-avatar"
            style={{ borderColor: member.color, backgroundColor: member.color + '22' }}
          >
            <MemberAvatar member={member} />
          </span>
          <div>
            <div className="focus-greeting">{GREETINGS[getTimeOfDay(now)]},</div>
            <div className="focus-name">{member.name}</div>
          </div>
        </div>
        <button type="button" className="focus-clock" onClick={handleClockTap} aria-label="Clock">
          <div className="focus-time">
            {format(now, settings.timeFormat === '24h' ? 'HH:mm' : 'h:mm a')}
          </div>
          <div className="focus-date">{format(now, 'EEEE, MMMM d')}</div>
        </button>
      </header>

      <main className="focus-body">
        {choresMan.loading && !choresMan.data ? (
          <LoadingPlaceholder
            label={t('planner.loading')}
            lines={5}
            className="loading-placeholder--screen"
          />
        ) : allDone ? (
          <div className="focus-celebration">
            <div className="focus-celebration-emoji">🎉</div>
            <div className="focus-celebration-title">All done — great job!</div>
          </div>
        ) : (
          <>
            {picks.map((pick) => (
              <RoutineCard
                key={pick.routine.id}
                routine={pick.routine}
                label={pick.label}
                interactive={pick.isCurrent}
                isTaskCompleted={(taskId) =>
                  routinesApi.isTaskCompletedToday(pick.routine.id, taskId, memberId)
                }
                onToggleTask={(taskId) => routinesApi.toggleTask(pick.routine, taskId)}
                onEdit={() =>
                  setRoutineEditorRequest({ token: Date.now(), routine: pick.routine, memberId })
                }
                onDelete={() => void routinesApi.removeRoutine(pick.routine.id)}
              />
            ))}
            <FocusChores
              chores={memberChores}
              completedIds={completedChoreIds}
              currencySymbol={settings.currencySymbol}
              onToggle={(choreId) => {
                // Ask first; the press itself happens after confirmation.
                if (!completedChoreIds.has(choreId)) setConfirmChoreId(choreId);
              }}
            />
            {picks.length === 0 && memberChores.length === 0 && (
              <div className="focus-empty">
                Nothing scheduled yet. Add a routine from Quick Add or the Chores page.
              </div>
            )}
          </>
        )}
      </main>

      {showExitConfirm && (
        <div className="focus-exit-backdrop" onClick={() => setShowExitConfirm(false)}>
          <div className="focus-exit-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Exit {member.name}&rsquo;s display?</p>
            <div className="focus-exit-actions">
              <button
                type="button"
                className="settings-btn"
                onClick={() => setShowExitConfirm(false)}
              >
                Cancel
              </button>
              <button type="button" className="settings-btn settings-btn--primary" onClick={onExit}>
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmChore && (
        <div className="focus-exit-backdrop" onClick={() => setConfirmChoreId(null)}>
          <div
            className="focus-exit-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              confirmIsDone ? t('chores.confirmDoneTitle') : t('chores.confirmClaimTitle')
            }
            onClick={(e) => e.stopPropagation()}
          >
            <p>{confirmIsDone ? t('chores.confirmDoneBody') : t('chores.confirmClaimBody')}</p>
            <p className="focus-confirm-target">{confirmChore.name}</p>
            <div className="focus-exit-actions">
              <button
                type="button"
                className="settings-btn"
                disabled={pendingChoreId === confirmChore.id}
                onClick={() => setConfirmChoreId(null)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                disabled={pendingChoreId === confirmChore.id}
                aria-busy={pendingChoreId === confirmChore.id}
                onClick={() => {
                  const chore = choresMan.data?.chores.find((c) => c.id === confirmChore.id);
                  // ChoresMan has no un-complete action: ticking claims or approves.
                  const actionId = chore?.actions.claim ?? chore?.actions.approve;
                  if (!actionId) {
                    setConfirmChoreId(null);
                    return;
                  }
                  setPendingChoreId(confirmChore.id);
                  void choresMan
                    .runActionId(actionId)
                    .then(() => {
                      if (confirmIsDone) setCelebration(true);
                      setConfirmChoreId(null);
                    })
                    .catch(() => undefined)
                    .finally(() => setPendingChoreId(null));
                }}
              >
                {pendingChoreId === confirmChore.id && <ActivitySpinner />}
                {t('chores.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {celebration && (
        <div className="planner-confetti planner-confetti--chore" aria-hidden="true">
          {Array.from({ length: 36 }, (_, index) => (
            <i
              key={index}
              style={
                {
                  '--confetti-index': index,
                  '--confetti-x': `${(index * 37) % 100}%`,
                  '--confetti-delay': `${(index % 8) * 0.045}s`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      {routineEditorRequest && (
        <RoutineEditorDialog
          key={routineEditorRequest.token}
          request={routineEditorRequest}
          members={members}
          locale={settings.locale}
          weekStartsOn={settings.weekStartsOn}
          onClose={() => setRoutineEditorRequest(null)}
          onSaved={routinesApi.refresh}
        />
      )}

      <ScreenSaver
        enabled={settings.screenSaverEnabled}
        dimTimeoutMin={settings.dimTimeout}
        screenSaverTimeoutMin={settings.screenSaverTimeout}
        mode={settings.screenSaverMode}
        timeFormat={settings.timeFormat}
        showSeconds={settings.showSeconds}
        photoIntervalSeconds={settings.photoInterval}
        photoDirectory={settings.photoDirectory}
        photoTransition={settings.photoTransition}
      />
    </div>
  );
}
