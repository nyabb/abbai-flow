import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  EyeOff,
  Filter,
  Plus,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  ChorePlannerState,
  PlannerTask,
  getPlannerTaskStatus,
} from '../../api/chore-planner-model';
import type { PlannerMember, PlannerRoutine } from '../../api/chore-planner-model';
import { buildChorePlannerView } from '../../api/chore-planner-view';
import { fetchChoreOpsChoreHistory } from '../../api/choreops-chore-history';
import type {
  ChoreOpsChoreHistoryEntity,
  ChoreOpsChoreHistoryEntry,
} from '../../api/choreops-chore-history';
import { fetchChoreOpsRewardHistory } from '../../api/choreops-ledger';
import type { ChoreOpsRewardHistoryEntry } from '../../api/choreops-ledger';
import { resolveMemberForUser, CHOREOPS_ALL_USERS } from '../../api/choreops';
import {
  activeRedemption,
  activeRedemptions,
  fulfilledRedemptions,
  spendableWithRedemptions,
} from '../../api/reward-redemptions';
import type { Redemption } from '../../api/reward-redemptions';
import type { ChoreOpsReward } from '../../types/choreops';
import { useChoreOps } from '../../hooks/useChoreOps';
import { usePlannerMeta } from '../../hooks/usePlannerMeta';
import { useRewardRedemptions } from '../../hooks/useRewardRedemptions';
import {
  findRoutine,
  missionStep,
  normaliseName,
  routineIdForTask,
  routineTaskOrder,
} from '../../api/planner-meta';
import { useTranslation } from '../../i18n';
import { LOCALE_OPTIONS } from '../../i18n/locales';
import { normalizePin, type FamilyMember } from '../../types/family';
import { MemberAvatar } from '../MemberAvatar';
import { usePlannerCopy } from './copy';
import { RewardRow, RoutineRow, TaskRow, type RoutineStep } from './rows';
import { HeaderDate } from '../PageHeader';
import { ChoreBoard } from './ChoreBoard';
import { ChoreEditor } from './ChoreEditor';
import { ConfirmSheet, PinSheet } from './ApprovalDialog';
import {
  ActionsSheet,
  AssignPointsSheet,
  AwardSheet,
  ClaimSheet,
  CreateSheet,
  FilterSheet,
  GoalsSheet,
  RewardActionsSheet,
  RewardFormSheet,
  RewardGivenSheet,
} from './sheets';
import { ChildView } from './ChildView';
import { MissionView } from './MissionView';
import {
  DAY_KEYS,
  MIN_PIN_LENGTH,
  clockTime,
  countdown,
  emptyForm,
  formFromLiveTask,
  toastWith,
  type FormValue,
} from './form';

/**
 * The planner is one board: a column per family member plus a column of chores
 * anybody may take. The mission screens are the optional step-by-step run
 * through one child's chores.
 */
type Screen = 'board' | 'child' | 'missions' | 'mission' | 'closing';

/** Outcome shown in the bottom-right notification. */
type ToastKind = 'success' | 'error';

const PAUSED_ROUTINES_KEY = 'beacon_paused_routines';

/**
 * Routines paused on this device before pause state moved into the shared
 * planner metadata. Read once, then imported, so the choice is not lost.
 */
function readPausedRoutines(): string[] {
  try {
    const raw = localStorage.getItem(PAUSED_ROUTINES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

interface ChorePlannerProps {
  /** Abbai Flow family members supply photos, colours, and display names. */
  members: FamilyMember[];
  /** App language (`AbbaiSettings.locale`); the planner has no own language switch. */
  locale: string;
  /** The same updater Settings uses, so picking a language here changes the whole app. */
  onLocaleChange: (locale: string) => void;
  /**
   * Asks the planner to open its "new chore" form for a chore or a routine,
   * e.g. from quick add. The token makes repeated requests distinct.
   */
  createRequest?: { kind: 'chore' | 'routine'; token: number };
}

export function ChorePlanner({
  members,
  locale,
  onLocaleChange,
  createRequest,
}: ChorePlannerProps) {
  const choreOps = useChoreOps();
  /**
   * Abbai Flow-owned planner metadata: the routine registry (identity + step order)
   * and per-child mission progress. ChoreOps has neither, so this is the only
   * place routines can be ordered, renamed or paused.
   */
  const plannerMeta = usePlannerMeta(readPausedRoutines());
  const meta = plannerMeta.meta;
  const [now, setNow] = useState(new Date());
  /**
   * ChoreOps is the single source of truth. There is no local chore store any
   * more: the board renders exactly what the integration publishes.
   */
  const view = useMemo(
    // `now` is part of the input: a daily routine's "done" only counts for the
    // day it was completed, so the board must re-evaluate at midnight.
    () => buildChorePlannerView(choreOps.data, members, now, meta),
    [choreOps.data, members, now, meta],
  );
  const data: ChorePlannerState = {
    members: view.members,
    tasks: view.tasks,
    goals: view.goals,
    routines: view.routines,
    routinesPaused: false,
    soundEnabled: true,
  };
  const { lang, dateLocale, t } = useTranslation();
  /** Tag for `toLocaleTimeString`/`toLocaleDateString` — follows the app locale. */
  const timeLocale = dateLocale.code || lang;
  const [screen, setScreen] = useState<Screen>('board');
  const [modal, setModal] = useState<
    | 'form'
    | 'actions'
    | 'claim'
    | 'award'
    | 'filter'
    | 'goals'
    | 'reward-form'
    | 'reward-actions'
    | 'assign'
    | 'reward-given'
    | 'create'
    | null
  >(null);
  const [form, setForm] = useState<FormValue>(() => emptyForm(new Date()));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  /**
   * Chore the child tapped, waiting for "are you sure?".
   *
   * Claiming and completing are one tap away on a shared display and a
   * mis-tap hands out points, so nothing is sent to ChoreOps until the child
   * confirms the card they meant.
   */
  const [confirmAction, setConfirmAction] = useState<{
    taskId: string;
    entityId: string;
    label: string;
    /** `done` for a parent sign-off, `claim` when the child takes the chore. */
    kind: 'claim' | 'done';
    /** What the toast says afterwards, e.g. "Geclaimd" or "Goedgekeurd". */
    action: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  /** Bottom-right notification: green for "done", red for "that failed". */
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const [confetti, setConfetti] = useState(false);
  const [goalCelebration, setGoalCelebration] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [todayMemberId, setTodayMemberId] = useState<string | null>(null);
  /** Child whose goals sheet is open, if any. */
  const [goalsMemberId, setGoalsMemberId] = useState<string | null>(null);
  /** Free chore whose "who is taking it?" sheet is open. */
  const [claimTaskId, setClaimTaskId] = useState<string | null>(null);
  /** Child whose detail page is open (the board is the overview). */
  const [childMemberId, setChildMemberId] = useState<string | null>(null);
  /** Chore just ticked: which goal should its points go to? */
  const [awardTaskId, setAwardTaskId] = useState<string | null>(null);
  /** Members hidden from the board, and the child whose mission run is open. */
  const [hiddenMemberIds, setHiddenMemberIds] = useState<string[]>([]);
  /** Routines paused comes from the shared metadata, not from this device. */
  const pausedRoutineIds = useMemo(
    () => meta.routines.filter((routine) => routine.paused).map((routine) => routine.id),
    [meta.routines],
  );
  const [missionIds, setMissionIds] = useState<string[]>([]);
  const [missionIndex, setMissionIndex] = useState(0);
  const [pinGate, setPinGate] = useState<{
    /** Heading shown in the PIN sheet ("Verwijderen", "Bewerken", ...). */
    title: string;
    /** What the PIN unlocks — normally the chore name. */
    description: string;
    /** Runs only once a parent PIN checks out; receives that parent's name. */
    run: (approverName?: string) => void;
  } | null>(null);
  const [livePin, setLivePin] = useState('');
  const [livePinError, setLivePinError] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [rewardForm, setRewardForm] = useState<{
    name: string;
    cost: number;
    memberIds: string[];
  }>({ name: '', cost: 10, memberIds: [] });
  /** Name of the reward being edited; `null` means the form creates a new one. */
  const [editingReward, setEditingReward] = useState<string | null>(null);
  const [selectedReward, setSelectedReward] = useState<ChoreOpsReward | null>(null);
  /** Reward whose explicit point allocation sheet is open. */
  const [assigningReward, setAssigningReward] = useState<ChoreOpsReward | null>(null);
  /** Reward just paid out; the sheet asks "use again" or "delete". */
  const [givenReward, setGivenReward] = useState<{ name: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /**
   * Reward progress (saving → achieved → given). Shared through beacon-store:
   * ChoreOps owns the definition and the deduction, not the pursuit.
   */
  const rewardsState = useRewardRedemptions();
  const redemptions = rewardsState.redemptions;
  const [rewardLedgerHistory, setRewardLedgerHistory] = useState<{
    userName: string;
    entries: ChoreOpsRewardHistoryEntry[];
  } | null>(null);
  const [choreHistorySnapshot, setChoreHistorySnapshot] = useState<{
    userName: string;
    entityKey: string;
    entries: ChoreOpsChoreHistoryEntry[];
  } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const c = usePlannerCopy();

  /**
   * A save that only reached this device must never look like it was stored.
   * Both stores (routine metadata and reward progress) report whether the
   * server accepted the write; when either fails, say so.
   */
  useEffect(() => {
    const failure = plannerMeta.error ?? rewardsState.error;
    if (failure) showToast(`${c.noFail}: ${failure}`, 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on change
  }, [plannerMeta.error, rewardsState.error]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  // One-way cleanup: the legacy per-device pause list is no longer authoritative.
  useEffect(() => {
    try {
      localStorage.removeItem(PAUSED_ROUTINES_KEY);
    } catch {
      /* Storage is optional. */
    }
  }, []);
  /**
   * Adopt routines that only exist as a ChoreOps label into the registry.
   *
   * A label is a display string with no identity: it cannot be renamed, ordered
   * or paused reliably. Adopting it once gives it a slug id and a task list, so
   * "Ochtendroutine" and "ochtendroutine " can never become two routines.
   */
  useEffect(() => {
    const legacy = view.routines.filter(
      (routine) => !routine.fallback && !findRoutine(meta, routine.id),
    );
    if (legacy.length === 0) return;
    void plannerMeta.runOp({
      type: 'adoptLabels',
      groups: legacy.map((routine) => ({
        label: routine.name,
        taskNames: routine.taskNames ?? [],
      })),
    });
  }, [view.routines, meta, plannerMeta]);
  useEffect(() => {
    if (!toast) return;
    // Errors stay a little longer: a parent needs time to read what ChoreOps
    // rejected, successes are just a confirmation.
    const timer = setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!confetti) return;
    const timer = setTimeout(() => setConfetti(false), 1200);
    return () => clearTimeout(timer);
  }, [confetti]);
  useEffect(() => {
    if (!goalCelebration) return;
    const timer = setTimeout(() => setGoalCelebration(false), 1800);
    return () => clearTimeout(timer);
  }, [goalCelebration]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  /** True when a gated action can actually be unlocked by someone. */
  const hasParentPin = useMemo(
    () =>
      members.some(
        (member) => member.role !== 'child' && normalizePin(member.pin).length >= MIN_PIN_LENGTH,
      ),
    [members],
  );

  const taskStatus = (task: PlannerTask) => getPlannerTaskStatus(task, now);

  /**
   * Label for the pill button, naming the action a tap performs:
   * claim an unclaimed shared chore, approve one that waits for a parent,
   * tick off the child's own chore. A claimed chore must never read
   * "Completed" — it is only finished once a parent signs it off.
   */
  const pillLabel = (task: PlannerTask, status: ReturnType<typeof taskStatus>) => {
    if (status === 'completed') return c.done;
    if (status === 'expired') return c.expired;
    // Waiting for a parent is not an action the child can take.
    if (task.awaitingReview) return c.awaitingApproval;
    if (task.audience === 'anyone') return c.claim;
    return c.done;
  };

  const openActions = (taskId: string) => {
    setSelectedTaskId(taskId);
    setConfirmingDelete(false);
    setModal('actions');
  };

  /** Planner member id → ChoreOps user name, for writing back to ChoreOps. */
  const userNameByMemberId = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of choreOps.data?.users ?? []) {
      const member = resolveMemberForUser(user.name, members);
      map.set(member ? member.id : `choreops:${user.name.trim().toLowerCase()}`, user.name);
    }
    return map;
  }, [choreOps.data, members]);
  const getTask = (id: string | null) =>
    data.tasks.find((task) => task.id === id) ??
    view.allTasks.find((task) => task.id === id) ??
    null;
  const selectedTask = getTask(selectedTaskId);
  const memberFor = (id: string | null) => data.members.find((member) => member.id === id) ?? null;
  /** ChoreOps rewards, one entry per user+reward (that is how it publishes them). */
  const rewards = choreOps.data?.rewards ?? [];
  const memberByName = (name: string | null) =>
    data.members.find(
      (member) => member.name.trim().toLowerCase() === (name ?? '').trim().toLowerCase(),
    ) ?? null;
  /** The rewards ChoreOps assigns to one planner member (via its ChoreOps user). */
  const rewardsForMember = (memberId: string | null): ChoreOpsReward[] => {
    const userName = memberId ? userNameByMemberId.get(memberId) : null;
    if (!userName) return [];
    const key = userName.trim().toLowerCase();
    return rewards.filter((reward) => (reward.assignee ?? '').trim().toLowerCase() === key);
  };
  const missionTask = getTask(missionIds[missionIndex] ?? null);

  /**
   * The routine the current mission belongs to, with the position inside it, so
   * the run can say "Morning routine · 2/3" instead of showing a bare chore and
   * leaving the child to wonder how it relates to the routine on the board.
   *
   * The position comes from persisted mission progress, not from the in-memory
   * queue, so a refresh cannot make a child look back at step 1.
   */
  const missionRoutineStep = (() => {
    const routineId = missionTask?.routineId;
    if (!routineId) return null;
    const userName = missionTask?.memberId ? userNameByMemberId.get(missionTask.memberId) : null;
    const step = missionStep(meta, userName, routineId);
    const fallback = missionIds.filter((id) => getTask(id)?.routineId === routineId);
    return {
      name: missionTask?.routineName ?? '',
      index:
        step.total > 0
          ? Math.min(step.total, step.done + (step.done < step.total ? 1 : 0))
          : fallback.indexOf(missionTask?.id ?? '') + 1,
      total: step.total || fallback.length,
    };
  })();
  const selectedTodayMember = memberFor(todayMemberId);

  /**
   * What a child can still spend: ChoreOps' balance minus the points already
   * promised to a reward. `rewards` is passed in so claims made in Home
   * Assistant also count as spent (approving one still deducts them later).
   */
  const spendableFor = (member: PlannerMember | null | undefined): number => {
    if (!member) return 0;
    const userName = userNameByMemberId.get(member.id);
    if (!userName) return member.savings;
    return spendableWithRedemptions(member.savings, redemptions, rewards, userName);
  };

  /**
   * A routine row: name, its part of the day, how far through it we are, and a
   * pause/resume tap. A paused routine stays visible but greyed out, so a
   * parent can see it is off and bring it back with one tap.
   */
  /**
   * One routine row for one child: its steps, how many are done, and a way to
   * start just this routine. Steps are per child, so the member is required.
   */
  const routineRow = (routine: PlannerRoutine, memberId: string) => {
    const paused = pausedRoutineIds.includes(routine.id);
    const steps = routineStepsFor(routine, memberId);
    return (
      <RoutineRow
        key={routine.id}
        routine={routine}
        paused={paused}
        label={routineLabel(routine)}
        progress={blockProgress(routine.timeBlock)}
        steps={steps}
        copy={c}
        onToggle={() => toggleRoutinePaused(routine.id, routine.name)}
        onStart={() => beginRoutine(memberId, routine)}
        canStart={steps.some((step) => step.open)}
        online={online}
        busyTaskId={pendingTaskId}
        onCompleteStep={(taskId) => {
          const task = getTask(taskId);
          if (!task) return;
          if (task.audience === 'anyone') openClaim(task);
          else void completeTask(task);
        }}
        onApproveStep={(name) => {
          const task = data.tasks.find(
            (item) =>
              item.routineId === routine.id &&
              item.memberId === memberId &&
              normaliseName(item.name) === normaliseName(name) &&
              item.awaitingReview &&
              item.actions?.approve,
          );
          if (task) approveTask(task);
        }}
        onMoreStep={(taskId) => openActions(taskId)}
      />
    );
  };
  /**
   * A reward row: progress towards the goal plus its actions. Shared by the
   * goals sheet and the child's detail page so both behave identically.
   */
  /** A reward row, shared by the goals sheet and the child detail page. */
  const renderRewardRow = (reward: ChoreOpsReward) => {
    const state = rewardState(reward);
    const approveId = reward.actions.approve;
    return (
      <RewardRow
        key={reward.id}
        reward={reward}
        allocated={state.allocated}
        remaining={state.remaining}
        done={state.done}
        pending={state.pending}
        canAdd={state.canAdd}
        copy={c}
        onAssign={() => openAssign(reward)}
        onUndo={() => undoRewardChoice(reward)}
        onApprove={() =>
          requestPin(
            c.rewards,
            reward.name,
            () => void runLiveAction(reward.id, approveId ?? '', reward.name, c.approved),
          )
        }
        onGive={() => {
          const pursuit = rewardState(reward).pursuit;
          if (pursuit) giveReward(pursuit);
        }}
        onMore={() => {
          setSelectedReward(reward);
          setModal('reward-actions');
        }}
      />
    );
  };
  /**
   * The one line under a board row's name, when there is something to say. The
   * board is dense, so quiet chores stay a single line.
   */
  const rowHint = (task: PlannerTask, status: string) =>
    task.awaitingReview && status !== 'completed'
      ? c.awaitingApproval
      : status === 'late'
        ? c.late
        : status === 'retry'
          ? c.retryCopy
          : status === 'upcoming'
            ? `${c.upcoming} ${clockTime(task.startsAt, timeLocale)}`
            : null;

  /**
   * One chore on the board: a round status button, the name and the points.
   * Everything a parent needs (approve, edit, delete) is on the row itself, so
   * the board never has to send you to a separate child page.
   */
  /** One chore on the board; the row component only knows what it displays. */
  const renderRow = (task: PlannerTask) => {
    const status = taskStatus(task);
    const label =
      task.awaitingReview && status !== 'completed'
        ? c.awaitingApproval
        : task.audience === 'anyone'
          ? c.claim
          : c.iDidIt;
    return (
      <TaskRow
        key={task.id}
        task={task}
        status={status}
        busy={pendingTaskId === task.id}
        online={online}
        copy={c}
        hint={rowHint(task, status)}
        actionLabel={label}
        onPrimary={() => {
          if (task.audience === 'anyone') {
            openClaim(task);
            return;
          }
          void completeTask(task);
        }}
        onMore={() => openActions(task.id)}
      />
    );
  };
  /** Calendar order for a list of chores. */
  /**
   * The routines a child can run, in board order, skipping paused ones and
   * routines that have nothing left to do for them today.
   */
  const missionsFor = (memberId: string) =>
    columnRoutines(memberId)
      .filter((routine) => !routine.paused && !pausedRoutineIds.includes(routine.id))
      .map((routine) => ({
        routine,
        tasks: routineTasksFor(routine, memberId),
      }))
      .filter((entry) => entry.tasks.length > 0);

  /**
   * A routine's own steps for one child, in the order the parent configured.
   * Order comes from the registry; chores ChoreOps has but the registry does
   * not know yet follow in ChoreOps order.
   */
  function routineTasksFor(routine: PlannerRoutine, memberId: string): PlannerTask[] {
    const order = routine.taskNames ?? routineTaskOrder(meta, routine.id);
    const open = data.tasks.filter(
      (task) =>
        task.routineId === routine.id &&
        task.memberId === memberId &&
        taskStatus(task) !== 'completed' &&
        taskStatus(task) !== 'expired',
    );
    const position = (task: PlannerTask) => {
      const index = order.findIndex((name) => normaliseName(name) === normaliseName(task.name));
      return index === -1 ? order.length : index;
    };
    return [...open].sort((a, b) => position(a) - position(b));
  }

  /**
   * A routine's steps for one child, in configured order, with today's state.
   *
   * A step counts as done when every ChoreOps row for it is completed today, and
   * it is open while at least one row still waits. Steps the registry knows but
   * ChoreOps has not published yet are listed as idle, so a routine that exists
   * only in Abbai Flow still shows what it is made of.
   */
  function routineStepsFor(routine: PlannerRoutine, memberId: string): RoutineStep[] {
    const order = routine.taskNames ?? routineTaskOrder(meta, routine.id);
    const mine = data.tasks.filter(
      (task) => task.routineId === routine.id && task.memberId === memberId,
    );
    const allMine = view.allTasks.filter(
      (task) => task.routineId === routine.id && task.memberId === memberId,
    );
    const names = [...order];
    for (const task of allMine) {
      if (!names.some((name) => normaliseName(name) === normaliseName(task.name))) {
        names.push(task.name);
      }
    }
    return names.map((name) => {
      const rows = mine.filter((task) => normaliseName(task.name) === normaliseName(name));
      const editRows = allMine.filter((task) => normaliseName(task.name) === normaliseName(name));
      const editTask = editRows.find((task) => rows.some((row) => row.id === task.id)) ?? editRows[0];
      const actionableTask = rows.find((task) => {
        const status = taskStatus(task);
        return (
          !task.awaitingReview &&
          !['upcoming', 'expired', 'completed'].includes(status) &&
          Boolean(task.actions?.claim ?? task.actions?.approve)
        );
      });
      return {
        name,
        ...(actionableTask ? { taskId: actionableTask.id } : {}),
        ...(editTask ? { editTaskId: editTask.id } : {}),
        done: rows.length > 0 && rows.every((task) => taskStatus(task) === 'completed'),
        open: rows.some((task) => !['completed', 'expired'].includes(taskStatus(task))),
        awaiting: rows.some((task) => task.awaitingReview && taskStatus(task) !== 'completed'),
      };
    });
  }

  /** The overview list is the queue: what it shows is what will be run. */
  const openTasksFor = (memberId: string) =>
    missionsFor(memberId).reduce<PlannerTask[]>((all, entry) => [...all, ...entry.tasks], []);

  /**
   * Is there anything to run for this child?
   *
   * The start button used to be disabled whenever the child had no *standalone*
   * chores, which is exactly the case for a child whose whole day is routines —
   * so the mission button looked dead.
   */
  const canRunMissions = (memberId: string) => missionsFor(memberId).length > 0;
  const byDeadline = (a: PlannerTask, b: PlannerTask) =>
    new Date(a.deadlineAt ?? a.expiresAt ?? a.startsAt).getTime() -
    new Date(b.deadlineAt ?? b.expiresAt ?? b.startsAt).getTime();

  /**
   * Open chores on one child's column: late ones first, then by deadline.
   * Chores still up for grabs are excluded here — they belong to the free
   * column until somebody takes one.
   */
  const columnTasks = (memberId: string) =>
    data.tasks
      .filter(
        (task) =>
          task.memberId === memberId &&
          task.audience !== 'anyone' &&
          // Routine steps live inside their routine, not in the chore list.
          !task.inRoutine &&
          !['completed', 'expired'].includes(taskStatus(task)),
      )
      .sort((a, b) => {
        const late = (task: PlannerTask) => (['late', 'retry'].includes(taskStatus(task)) ? 0 : 1);
        return late(a) - late(b) || byDeadline(a, b);
      });

  /**
   * Chores still up for grabs. ChoreOps publishes one row per user for a
   * first-come-first-served chore, so the board shows the chore once and asks
   * which child is taking it when somebody taps it.
   */
  const freeTasks = [...data.tasks]
    .filter(
      (task) => task.audience === 'anyone' && !task.inRoutine && taskStatus(task) !== 'completed',
    )
    .filter((task, index, all) => all.findIndex((other) => other.name === task.name) === index)
    .sort(byDeadline);

  /** Every row of one free chore, i.e. one claim button per child. */
  const claimOptionsFor = (task: PlannerTask) =>
    data.tasks.filter(
      (other) => other.name === task.name && other.audience === 'anyone' && other.actions?.claim,
    );

  /** Open the "who is taking this?" sheet for a free chore. */
  const openClaim = (task: PlannerTask) => {
    setClaimTaskId(task.id);
    setModal('claim');
  };

  /** The routines that belong to one child (ChoreOps groups them by label). */
  const columnRoutines = (memberId: string) =>
    data.routines.filter((routine) => routine.memberIds.includes(memberId));

  /** Columns on the board: the ones a parent has not filtered out. */
  const boardMembers = data.members.filter((member) => !hiddenMemberIds.includes(member.id));

  /** Completed chores of one child today (the detail page's history). */
  const completedTasksFor = (memberId: string) =>
    data.tasks.filter(
      (task) =>
        task.memberId === memberId && !task.inRoutine && taskStatus(task) === 'completed',
    );

  /** Step to the previous/next child from the detail page. */
  const stepChild = (delta: number) => {
    if (!childMember) return;
    const list = boardMembers;
    const index = list.findIndex((member) => member.id === childMember.id);
    if (index === -1) return;
    const next = list[(index + delta + list.length) % list.length];
    if (next) setChildMemberId(next.id);
  };

  /** Pause a routine in the shared metadata so every device agrees. */
  const toggleRoutinePaused = (routineId: string, routineName?: string) => {
    void plannerMeta.runOp({ type: 'toggleRoutinePaused', id: routineId, name: routineName });
  };

  /**
   * The award sheet asks where the earned points should go as soon as a chore is ticked.
   * We do the same: complete the chore, then offer this child's goals.
   */
  const awardTask = getTask(awardTaskId);

  /**
   * How far through its part of the day a routine is: the reference app puts a
   * small time bar on every routine row.
   */
  const blockProgress = (block: string) => {
    const hour = now.getHours() + now.getMinutes() / 60;
    const [start, end] =
      block === 'morning' ? [6, 12] : block === 'afternoon' ? [12, 17] : [17, 22];
    return Math.min(100, Math.max(0, ((hour - start) / (end - start)) * 100));
  };

  /** "Ochtend · dagelijks" for a routine row's second line. */
  const routineLabel = (routine: PlannerRoutine) => {
    const block =
      routine.timeBlock === 'morning'
        ? c.morning
        : routine.timeBlock === 'evening'
          ? c.evening
          : c.afternoon;
    return `${block} · ${routine.frequency === 'daily' ? c.daily : routine.frequency}`;
  };

  /** Open the goal sheet of one child, where their rewards live. */
  const openGoals = (memberId: string) => {
    setGoalsMemberId(memberId);
    setModal('goals');
  };
  const goalsMember = memberFor(goalsMemberId);
  const goalsUserName = goalsMember ? (userNameByMemberId.get(goalsMember.id) ?? null) : null;
  const goalsLedgerHistory =
    rewardLedgerHistory?.userName === goalsUserName ? rewardLedgerHistory.entries : [];
  useEffect(() => {
    if (modal !== 'goals' || !goalsUserName || !choreOps.available) {
      setRewardLedgerHistory(null);
      return;
    }

    let current = true;
    setRewardLedgerHistory(null);
    void fetchChoreOpsRewardHistory(goalsUserName)
      .then((history) => {
        if (current) setRewardLedgerHistory({ userName: goalsUserName, entries: history });
      })
      .catch(() => {
        // Older ChoreOps versions may not expose get_ledger. Keep the
        // Abbai Flow history available when the optional ledger query fails.
        if (current) setRewardLedgerHistory({ userName: goalsUserName, entries: [] });
      });

    return () => {
      current = false;
    };
  }, [modal, goalsUserName, choreOps.available]);
  const claimTask = getTask(claimTaskId);
  const childMember = memberFor(childMemberId);
  const childUserName = childMember ? (userNameByMemberId.get(childMember.id) ?? null) : null;
  const childHistoryEntities = useMemo<ChoreOpsChoreHistoryEntity[]>(() => {
    const userKey = childUserName?.trim().toLocaleLowerCase();
    if (!userKey) return [];
    return (choreOps.data?.chores ?? []).flatMap((chore) => {
      const label = (chore.labels ?? []).map((item) => item.trim()).find(Boolean) ?? null;
      const isRoutineStep =
        /^daily/i.test(chore.frequency ?? '') &&
        routineIdForTask(meta, chore.name, label) !== null;
      return chore.statusEntityId &&
        chore.assignee?.trim().toLocaleLowerCase() === userKey &&
        !isRoutineStep
        ? [
            {
              entityId: chore.statusEntityId,
              choreName: chore.name,
              points: chore.points,
            },
          ]
        : [];
    });
  }, [choreOps.data?.chores, childUserName, meta]);
  const childHistoryEntityKey = childHistoryEntities
    .map((entity) => entity.entityId)
    .sort()
    .join('|');
  const childChoreHistory =
    choreHistorySnapshot?.userName === childUserName &&
    choreHistorySnapshot.entityKey === childHistoryEntityKey
      ? choreHistorySnapshot.entries
      : null;
  useEffect(() => {
    if (screen !== 'child' || !childUserName || !choreOps.available) {
      setChoreHistorySnapshot(null);
      return;
    }

    let current = true;
    setChoreHistorySnapshot(null);
    void fetchChoreOpsChoreHistory(childHistoryEntities)
      .then((history) => {
        if (current) {
          setChoreHistorySnapshot({
            userName: childUserName,
            entityKey: childHistoryEntityKey,
            entries: history,
          });
        }
      })
      .catch(() => {
        if (current) {
          setChoreHistorySnapshot({
            userName: childUserName,
            entityKey: childHistoryEntityKey,
            entries: [],
          });
        }
      });

    return () => {
      current = false;
    };
  }, [screen, childUserName, childHistoryEntities, childHistoryEntityKey, choreOps.available]);
  /** The filter sheet doubles as the board's filter state indicator. */
  const filterOpen = modal === 'filter';

  const showToast = (message: string, kind: ToastKind = 'success') => setToast({ message, kind });
  const playCompletionSound = () => {
    if (!data.soundEnabled) return;
    try {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) return;
      const audio = new AudioContextConstructor();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.06, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.22);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.22);
      oscillator.onended = () => void audio.close();
    } catch {
      /* Audio is optional. */
    }
  };

  const advanceMission = () => {
    if (missionIndex + 1 < missionIds.length) setMissionIndex((index) => index + 1);
    else setScreen('closing');
  };

  const completeTask = async (task: PlannerTask) => {
    if (pendingTaskId) return;
    // Nothing to press on chores that are not open yet or already signed off.
    if (['upcoming', 'expired', 'completed'].includes(taskStatus(task))) return;

    /*
     * A chore that is waiting for a parent is *finished* from the child's side.
     * Approving it awards the points, so it is not offered here at all: the
     * parent signs off from the row's actions sheet, behind the parent PIN.
     * (A child device used to reach the approve button through this very
     * check button.)
     */
    if (task.awaitingReview) {
      showToast(toastWith(c.awaitingApproval, task.name));
      return;
    }

    // Otherwise this is the child's own action: claim a free chore, or mark an
    // assigned one as done so it enters the approval queue.
    const entityId = task.actions?.claim ?? task.actions?.approve;
    if (!entityId) {
      showToast(c.assignToClaim);
      return;
    }

    // Ask first: a mis-tap would claim the chore and hand out points.
    // Only a chore nobody owns yet is "claimed"; one that was already assigned
    // to this child is just finished, so it gets the "are you done?" wording.
    const claiming = task.audience === 'anyone';
    setConfirmAction({
      taskId: task.id,
      entityId,
      label: task.name,
      kind: claiming ? 'claim' : 'done',
      action: claiming ? c.claimedToast : task.awaitingReview ? c.approved : c.done,
    });
  };

  /** Press a ChoreOps button and report the outcome, then re-read its entities. */
  const runLiveAction = async (taskId: string, entityId: string, label: string, action: string) => {
    if (pendingTaskId) return;
    setPendingTaskId(taskId);
    try {
      await choreOps.pressButton(entityId);
      setConfetti(true);
      playCompletionSound();
      showToast(toastWith(action, label));
      if (screen === 'mission') {
        // Remember the step so "2 of 4" survives a refresh and the child is
        // never asked to redo a step to get back to the right place.
        const task = getTask(taskId);
        const userName = task?.memberId ? userNameByMemberId.get(task.memberId) : null;
        if (task?.routineId && userName) {
          void plannerMeta.runOp({
            type: 'markStep',
            user: userName,
            routineId: task.routineId,
            taskName: task.name,
          });
        }
        advanceMission();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : c.noFail, 'error');
    } finally {
      /* Must clear on success too: leaving it set made `completeTask` bail out
         for every later card, so a second chore only worked after a reload. */
      setPendingTaskId(null);
    }
  };

  const submitPin = () => {
    if (!pinGate) return;
    const entered = normalizePin(livePin);
    const approver = members.find(
      (member) =>
        member.role !== 'child' &&
        normalizePin(member.pin).length >= MIN_PIN_LENGTH &&
        normalizePin(member.pin) === entered,
    );
    if (!approver) {
      setLivePinError(true);
      return;
    }
    const gate = pinGate;
    setPinGate(null);
    setLivePin('');
    gate.run(approver.name);
  };

  /**
   * Gate a destructive action behind a parent PIN.
   *
   * With no parent PIN configured the action simply runs — otherwise a household
   * that never set one could not change anything at all.
   */
  const requestPin = (title: string, description: string, run: (approverName?: string) => void) => {
    if (!hasParentPin) {
      run();
      return;
    }
    setLivePin('');
    setLivePinError(false);
    setPinGate({ title, description, run });
  };

  /**
   * Parent sign-off for a chore waiting in review.
   *
   * A routine step has no row actions on the board and the mission overview is
   * read-only, so this is the one visible way to approve such a chore. It is
   * always PIN-gated (or runs immediately when the household has no PIN, like
   * every other parent action).
   */
  const approveTask = (task: PlannerTask) => {
    const entityId = task.actions?.approve;
    if (!entityId) {
      showToast(c.awaitingApproval, 'error');
      return;
    }
    requestPin(
      c.approveCompletion,
      task.name,
      () => void runLiveAction(task.id, entityId, task.name, c.approved),
    );
  };

  const openNewForm = (kind: 'chore' | 'routine' = 'chore') => {
    setEditingId(null);
    // A routine is a chore that repeats daily and belongs to a named routine.
    setForm(
      kind === 'routine'
        ? {
            ...emptyForm(now),
            kind: 'routine',
            frequency: 'daily',
            liveFrequency: 'daily',
            timeBlock: 'morning',
          }
        : emptyForm(now),
    );
    setModal('form');
  };

  /* Quick add's "chore"/"routine" entries land here: the token changes once per
     request, so the form opens even when this page is already on screen. */
  const createToken = createRequest?.token ?? 0;
  useEffect(() => {
    if (createToken === 0) return;
    openNewForm(createRequest?.kind ?? 'chore');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the token counts
  }, [createToken]);

  /**
   * Open the reward form. A child's goals sheet preselects that child; the
   * header create menu starts empty and lets the parent pick who gets it.
   */
  const startRewardForm = (memberId?: string) => {
    setEditingReward(null);
    setRewardForm({ name: '', cost: 10, memberIds: memberId ? [memberId] : [] });
    setModal('reward-form');
  };

  const openEditForm = (task: PlannerTask) => {
    if (hasParentPin) setModal(null);
    requestPin(c.edit, task.name, () => {
      // ChoreOps is the source of truth: prefill from its own record of the chore.
      const chore =
        choreOps.data?.chores.find(
          (item) => item.name.trim().toLowerCase() === task.name.trim().toLowerCase(),
        ) ?? null;
      setEditingId(task.id);
      setForm(formFromLiveTask(task, chore));
      setModal('form');
    });
  };

  const saveForm = async () => {
    if (!form.name.trim() || (!form.memberIds.length && !form.free) || saving) return;

    /*
     * "Free for anyone to claim" is ChoreOps' `*` sentinel, not an empty
     * assignee list: ChoreOps treats an empty list as a dormant chore and
     * publishes no entities for it, so the chore would silently vanish.
     */
    const userNames = form.free
      ? [CHOREOPS_ALL_USERS]
      : form.memberIds
          .map((id) => userNameByMemberId.get(id))
          .filter((name): name is string => Boolean(name));
    if (userNames.length === 0) {
      showToast(c.assignToClaim);
      return;
    }

    /*
     * Recurrence belongs to routines. A new task is a one-off, so it is created
     * as `none` rather than carrying whatever the form happened to hold -- the
     * editor hides the schedule for exactly that case. Edits keep whatever
     * repeat ChoreOps already has, so nothing is rewritten behind the user.
     */
    const frequency = form.kind === 'task' && !editingId ? 'none' : form.liveFrequency;
    /*
     * Labels are the routine name. They are only sent when the field differs
     * from what ChoreOps already has, so editing e.g. the points of a chore
     * whose label Abbai Flow cannot see never wipes that label. Clearing the field
     * sends `[]`, which is how a routine is removed again.
     */
    const currentLabel = (
      choreOps.data?.chores.find(
        (item) => item.name.trim().toLowerCase() === form.name.trim().toLowerCase(),
      )?.labels?.[0] ?? ''
    ).trim();
    const nextLabel = form.liveLabel.trim();
    const labels = nextLabel === currentLabel ? undefined : nextLabel ? [nextLabel] : [];
    const schedule = {
      frequency,
      customInterval:
        frequency === 'custom' || frequency === 'custom_from_complete'
          ? form.liveInterval
          : undefined,
      customIntervalUnit: form.liveIntervalUnit,
      applicableDays:
        frequency === 'weekly' ? form.liveWeekdays.map((day) => DAY_KEYS[day]) : undefined,
      // Sent exactly as the form shows it: ChoreOps decides whether the date is
      // acceptable and its message is what the (red) toast shows.
      dueDate: form.deadlineAt ? new Date(form.deadlineAt).toISOString() : undefined,
      description: form.liveDescription,
      autoApprove: form.liveAutoApprove,
      // The first ChoreOps label groups daily chores into a named routine.
      labels,
    };
    try {
      setSaving(true);
      if (editingId) {
        await choreOps.updateChore({
          ...schedule,
          name: form.name,
          assignedUserNames: userNames,
          points: form.points,
          windowOffset: form.liveWindow,
          reminderOffset: form.liveReminder,
        });
      } else {
        await choreOps.createChore({
          ...schedule,
          name: form.name,
          assignedUserNames: userNames,
          // One open chore that whoever gets to it first completes — otherwise
          // every child would get their own private copy to check off.
          completionCriteria: form.free ? 'shared_first' : undefined,
          points: form.points,
          windowOffset: form.liveWindow,
          reminderOffset: form.liveReminder,
        });
      }
      setModal(null);
      showToast(toastWith(editingId ? c.savedToast : c.created, form.name.trim()));

      /*
       * Routine membership is Abbai Flow metadata, not a ChoreOps field: the label
       * names the routine, and the registry remembers the chore belongs to it
       * (with an order ChoreOps cannot store). A cleared label removes it again.
       */
      const taskName = form.name.trim();
      if (nextLabel) {
        const routine = (await plannerMeta.runOp({
          type: 'upsertRoutine',
          name: nextLabel,
        })) as { id?: string } | null;
        if (routine && typeof routine.id === 'string') {
          await plannerMeta.runOp({
            type: 'addRoutineTask',
            id: routine.id,
            taskName,
          });
        }
      } else if (editingId && currentLabel) {
        const owner = meta.routines.find((routine) =>
          routine.taskNames.some((name) => normaliseName(name) === normaliseName(taskName)),
        );
        if (owner) {
          await plannerMeta.runOp({
            type: 'removeRoutineTask',
            id: owner.id,
            taskName,
          });
        }
      }
    } catch (err) {
      // ChoreOps replies with the exact reason (e.g. "The requested changes
      // require a future due date"); show it verbatim in the red toast.
      showToast(err instanceof Error ? err.message : c.noFail, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeTask = async (task: PlannerTask) => {
    try {
      await choreOps.deleteChore(task.name);
      setModal(null);
      showToast(toastWith(c.removedToast, task.name));
    } catch (err) {
      showToast(err instanceof Error ? err.message : c.noFail, 'error');
    }
  };

  /**
   * Create a reward in ChoreOps for the chosen children.
   *
   * ChoreOps publishes one reward entity per user, so `assigned_user_names` is
   * what makes the reward belong to that child — different kids can have
   * different rewards with different costs.
   */
  const saveReward = async () => {
    if (saving) return;

    if (editingReward) {
      const update = async () => {
        try {
          setSaving(true);
          await choreOps.updateReward({ name: editingReward, cost: rewardForm.cost });
          setModal(null);
          showToast(`${c.savedToast} \u00b7 ${editingReward}`);
        } catch (err) {
          showToast(err instanceof Error ? err.message : c.noFail, 'error');
        } finally {
          setSaving(false);
        }
      };
      requestPin(c.cost, editingReward, () => void update());
      return;
    }

    const userNames = rewardForm.memberIds
      .map((id) => userNameByMemberId.get(id))
      .filter((name): name is string => Boolean(name));
    if (!rewardForm.name.trim() || userNames.length === 0) return;

    const create = async () => {
      try {
        setSaving(true);
        await choreOps.createReward({
          name: rewardForm.name.trim(),
          cost: rewardForm.cost,
          assignedUserNames: userNames,
        });
        setModal(null);
        showToast(`${c.savedToast} \u00b7 ${rewardForm.name.trim()}`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : c.noFail, 'error');
      } finally {
        setSaving(false);
      }
    };
    requestPin(c.newReward, rewardForm.name.trim(), () => void create());
  };

  /**
   * Delete a reward from ChoreOps.
   *
   * `skipPin` is only used by the post-payout prompt: the parent has already
   * unlocked the payout in this very flow, so asking for the PIN twice would be
   * noise rather than a second decision.
   */
  const removeReward = async (reward: Pick<ChoreOpsReward, 'name'>, skipPin = false) => {
    const remove = async () => {
      try {
        setSaving(true);
        await choreOps.deleteReward(reward.name);
        setGivenReward(null);
        setModal(null);
        showToast(toastWith(c.removedToast, reward.name));
      } catch (err) {
        showToast(err instanceof Error ? err.message : c.noFail, 'error');
      } finally {
        setSaving(false);
      }
    };
    /*
     * Deleting a reward removes the definition for every child it is assigned
     * to, and a goal that was already reached is waiting to be handed over.
     * Both are parent decisions, so this is always PIN-gated — it used to be
     * free for a fully funded goal, which let a child delete a reward they were
     * about to receive.
     */
    if (skipPin) {
      await remove();
      return;
    }
    requestPin(c.remove, reward.name, () => void remove());
  };

  /**
   * Ask how many points go towards this reward.
   *
   * The allocation is explicit: a child can fund several goals side by side
   * (5 here, 3 there) and leave the rest in the savings pot. The old button
   * silently took as much as the goal still needed.
   */
  const openAssign = (reward: ChoreOpsReward) => {
    if (!rewardState(reward).canAdd) return;
    setAssigningReward(reward);
    setModal('assign');
  };

  /**
   * Put points aside for a reward.
   *
   * Approval-free and Abbai Flow-only: the balance drops the moment the child
   * allocates, and nothing is written to ChoreOps, so they can still change
   * their mind. The amount is chosen explicitly by the child; points accumulate
   * towards the cost instead of being reserved in one go -- that is what makes
   * "on hold" (partway) and "reached the goal" (fully covered) two different
   * states.
   */
  const assignReward = (reward: ChoreOpsReward, amount: number) => {
    const userName =
      reward.assignee ??
      (selectedTodayMember ? userNameByMemberId.get(selectedTodayMember.id) : null);
    if (!userName) {
      showToast(c.assignToClaim, 'error');
      return;
    }

    const owner = memberByName(userName);
    const already = activeRedemption(redemptions, userName, reward.name)?.points ?? 0;
    const stillNeeded = Math.max(0, reward.cost - already);
    // Never invent points: the explicit amount is still capped by what the
    // child can spend and by what the goal still needs.
    const give = Math.min(Math.round(amount), stillNeeded, owner ? spendableFor(owner) : 0);
    if (give <= 0) return;

    void rewardsState.runOp({
      type: 'addPoints',
      user: userName,
      reward: reward.name,
      cost: reward.cost,
      amount: give,
    });
    showToast(toastWith(c.assignedToast, reward.name));
  };

  /** Give the points back -- the child changed their mind, or wants it again. */
  const undoRewardChoice = (reward: ChoreOpsReward) => {
    const pursuit = activeRedemption(redemptions, reward.assignee, reward.name);
    if (pursuit) {
      void rewardsState.runOp({ type: 'release', id: pursuit.id });
    }
    showToast(toastWith(c.undoneToast, reward.name));
  };

  /**
   * Parent hands a reached reward over.
   *
   * ChoreOps deducts the cost through `approve_reward` and Abbai Flow records who
   * gave what and when. A child can never reach this: it is behind the PIN, and
   * the redemption only exists once the goal is actually achieved.
   */
  const giveReward = (redemption: Redemption) => {
    const member = memberByName(redemption.user);
    const userName = member ? userNameByMemberId.get(member.id) : null;
    if (!userName) {
      showToast(c.assignToClaim, 'error');
      return;
    }
    requestPin(c.approvePayout, redemption.rewardLabel, (approverName) => {
      void (async () => {
        try {
          setSaving(true);
          await choreOps.approveReward(userName, redemption.rewardLabel, approverName);
          await rewardsState.runOp({
            type: 'fulfil',
            id: redemption.id,
            by: approverName,
          });
          showToast(toastWith(c.rewardGiven, redemption.rewardLabel));
          setConfetti(true);
          /*
           * The goal is met and handed over. Ask the parent what happens to the
           * definition: save for it again from zero, or remove it altogether.
           */
          const definition =
            rewards.find(
              (item) =>
                normaliseName(item.name) === normaliseName(redemption.reward) &&
                normaliseName(item.assignee) === normaliseName(redemption.user),
            ) ?? null;
          setGivenReward({ name: definition?.name ?? redemption.rewardLabel });
          setModal('reward-given');
        } catch (err) {
          showToast(err instanceof Error ? err.message : c.noFail, 'error');
        } finally {
          setSaving(false);
        }
      })();
    });
  };

  /** Payout done: keep the goal and put it back at 0 allocations. */
  const reuseGivenReward = () => {
    if (!givenReward) return;
    const name = givenReward.name;
    setGivenReward(null);
    setModal(null);
    showToast(toastWith(c.rewardReset, name));
  };

  /** Payout done: delete the definition; the payout PIN already covered this. */
  const deleteGivenReward = () => {
    if (!givenReward) return;
    void removeReward(givenReward, true);
  };

  /**
   * Reward card state shared by the child screen and the rewards sheet:
   * how much is set aside, what is still missing, and whether the goal is met.
   *
   * `done` means *the goal is achieved* — not that the child has the reward.
   * The reward is still waiting for a parent at that point.
   */
  const rewardState = (reward: ChoreOpsReward) => {
    const owner = memberByName(reward.assignee);
    const pursuit = activeRedemption(redemptions, reward.assignee, reward.name);
    const saved = owner ? spendableFor(owner) : 0;
    const allocated = pursuit?.points ?? 0;
    const remaining = Math.max(0, reward.cost - allocated);
    const status = reward.status.toLowerCase();
    // ChoreOps marks rewards `locked` when the balance is below the full
    // cost. Abbai Flow supports smaller allocations, so the child can still
    // save toward a locked reward while they have points.
    const canSave = status === 'available' || status === 'locked';
    return {
      owner,
      pursuit,
      saved,
      allocated,
      remaining,
      /** Reached the cost: waiting for a parent to hand it over. */
      done: pursuit?.state === 'awaiting_fulfilment',
      available: status === 'available',
      pending: reward.pendingClaims > 0,
      canAdd: canSave && saved > 0 && remaining > 0,
    };
  };

  /** Start the guided run through one child's first open routine. */
  /** Start one routine as a mission, without walking the child's other routines. */
  const beginRoutine = (memberId: string, routine: PlannerRoutine) => {
    const steps = routineTasksFor(routine, memberId);
    setTodayMemberId(memberId);
    if (steps.length === 0) {
      setMissionIds([]);
      setMissionIndex(0);
      setScreen('closing');
      return;
    }
    const userName = userNameByMemberId.get(memberId);
    if (userName) {
      void plannerMeta.runOp({ type: 'startMission', user: userName, routineId: routine.id });
    }
    setMissionIds(steps.map((task) => task.id));
    setMissionIndex(0);
    setScreen('mission');
  };

  const beginMissions = (memberId: string) => {
    setTodayMemberId(memberId);
    // A mission is a run through *routines*, in the order the parent configured;
    // standalone chores never enter the queue.
    const runs = missionsFor(memberId);
    if (runs.length === 0) {
      setMissionIds([]);
      setMissionIndex(0);
      setScreen('closing');
      return;
    }
    const first = runs[0];
    const userName = userNameByMemberId.get(memberId);
    if (userName) {
      void plannerMeta.runOp({ type: 'startMission', user: userName, routineId: first.routine.id });
    }
    setMissionIds(first.tasks.map((task) => task.id));
    setMissionIndex(0);
    setScreen('mission');
  };

  /**
   * Open the missions overview — the same screen the mission's back arrow
   * returns to. The overview is the clear entry point from the routine UI;
   * "Start missions" on it begins the actual run.
   */
  const openMissions = (memberId: string) => {
    setTodayMemberId(memberId);
    setMissionIds([]);
    setMissionIndex(0);
    setScreen('missions');
  };

  const renderTask = (task: PlannerTask, readOnly = false) => {
    const status = taskStatus(task);
    const assigned = memberFor(task.memberId);
    const deadline = status === 'upcoming' ? task.startsAt : (task.deadlineAt ?? task.expiresAt);
    // ChoreOps reports completion as a status, so fall back to the due time for
    // the label instead of printing an invalid date.
    const completedAt = task.completedAt ?? deadline;
    // A claimed chore is not "still X minutes left": it waits for a parent.
    const subtitle =
      task.awaitingReview && status !== 'completed'
        ? c.claimed
        : status === 'upcoming'
          ? `${c.upcoming} ${clockTime(task.startsAt, timeLocale)}`
          : status === 'active'
            ? deadline
              ? `${c.active} ${countdown(deadline, now, c)}`
              : c.open
            : status === 'retry'
              ? `${c.retryCopy} · ${countdown(deadline ? new Date(new Date(deadline).getTime() + (task.retryMinutes ?? 0) * 60_000).toISOString() : null, now, c)}`
              : status === 'late'
                ? c.late
                : status === 'expired'
                  ? c.expired
                  : completedAt
                    ? `${c.completedAt} ${clockTime(completedAt, timeLocale)}`
                    : c.done;
    const timeLabel =
      task.timeBlock === 'morning'
        ? c.morning
        : task.timeBlock === 'afternoon'
          ? c.afternoon
          : task.timeBlock === 'evening'
            ? c.evening
            : deadline
              ? `${c.due} ${clockTime(deadline, timeLocale)}`
              : null;
    return (
      <article
        key={task.id}
        className={`planner-task planner-task--${status}${
          task.audience === 'anyone' ? ' planner-task--anyone' : ''
        }`}
        style={{ '--member-color': assigned?.color ?? '#cf6d55' } as React.CSSProperties}
        onPointerDown={(event) => {
          if (readOnly || (event.target as HTMLElement).closest('button')) return;
          holdTimer.current = setTimeout(() => openActions(task.id), 800);
        }}
        onPointerUp={() => {
          if (holdTimer.current) clearTimeout(holdTimer.current);
        }}
        onPointerLeave={() => {
          if (holdTimer.current) clearTimeout(holdTimer.current);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!readOnly) openActions(task.id);
        }}
      >
        <button
          className={`planner-check ${status === 'completed' ? 'is-checked' : ''}`}
          type="button"
          disabled={
            readOnly ||
            !online ||
            status === 'upcoming' ||
            status === 'completed' ||
            pendingTaskId === task.id ||
            (!task.memberId && status !== 'expired')
          }
          /* The visible label alone repeats across cards ("Completed" x3), so
             the accessible name carries the chore too. */
          aria-label={`${pillLabel(task, status)}: ${task.name}`}
          onClick={() => void completeTask(task)}
        >
          {/* Pill action with the points in its own coloured segment — the
              family-planner "Afvinken maar! | 🏆 25" pattern. The label names
              the action the tap performs, so a claimed chore reads "Approve",
              not "Completed". */}
          <span className="planner-check-label">{pillLabel(task, status)}</span>
          <span className="planner-check-icon" aria-hidden="true">
            {pendingTaskId === task.id ? (
              <span className="planner-spinner" />
            ) : status === 'completed' ? (
              <Check />
            ) : status === 'expired' ? (
              <RotateCcw />
            ) : task.audience === 'anyone' ? (
              /* Up for grabs: a hand instead of the empty "done" circle, so it
                 reads as "take this" rather than "this is your task". */
              <span className="planner-check-hand">{'\u270B'}</span>
            ) : null}
          </span>
          {task.points > 0 && (
            <span className="planner-check-points" aria-hidden="true">
              <span>{'\u{1F3C6}'}</span>
              {task.points}
            </span>
          )}
        </button>
        <div className="planner-task-copy">
          <div className="planner-task-title-row">
            <span className="planner-status-dot" />
            {task.icon && (
              <span className="planner-task-icon" aria-hidden="true">
                {task.icon}
              </span>
            )}
            <h3 className={status === 'expired' ? 'is-struck' : ''}>{task.name}</h3>
          </div>
          <p>{subtitle}</p>
        </div>
        <div className="planner-task-meta">
          {/* "Anyone" and "Everyone" chores are still grouped per child, so the
              chip has to say who the chore is really for instead of naming the
              child the group happens to be for. */}
          {task.audience === 'anyone' ? (
            <span className="planner-member-chip planner-member-chip--anyone">
              <span aria-hidden="true">{'\u{1F3C1}'}</span>
              {c.anyone}
            </span>
          ) : task.audience === 'everyone' ? (
            <span className="planner-member-chip planner-member-chip--everyone">
              <span aria-hidden="true">{'\u{1F465}'}</span>
              {c.everyone}
            </span>
          ) : assigned ? (
            <span className="planner-member-chip">
              <span>
                <MemberAvatar member={assigned} />
              </span>
              {assigned.name}
            </span>
          ) : null}
          {timeLabel && (
            <span className="planner-time">
              <Clock3 size={18} />
              {timeLabel}
            </span>
          )}
          {/* A chore waiting for review needs a visible parent action: the
              mission overview is read-only and routine steps have no row menu. */}
          {task.awaitingReview && status !== 'completed' && task.actions?.approve && (
            <button type="button" className="planner-approve" onClick={() => approveTask(task)}>
              {c.approveCompletion}
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              className="planner-task-more"
              aria-label={`${c.action}: ${task.name}`}
              onClick={() => openActions(task.id)}
            >
              {'\u22ef'}
            </button>
          )}
        </div>
      </article>
    );
  };

  const completedTodayPoints = (id: string) =>
    data.tasks
      .filter((task) => task.memberId === id && taskStatus(task) === 'completed')
      .reduce((sum, task) => sum + task.points, 0);
  const activeMissionStatus = missionTask ? taskStatus(missionTask) : 'completed';

  const heading =
    screen === 'missions' || screen === 'mission'
      ? c.missions
      : screen === 'closing'
        ? c.todayEarned
        : screen === 'child'
          ? (childMember?.name ?? c.title)
          : c.title;

  return (
    <div className={`chore-planner ${privacy ? 'chore-planner--private' : ''}`}>
      <header className="planner-header">
        {(screen === 'missions' || screen === 'child') && (
          <button
            className="planner-icon-button"
            onClick={() => setScreen('board')}
            aria-label={c.back}
          >
            <ArrowLeft />
          </button>
        )}
        {screen === 'mission' && (
          <button
            className="planner-icon-button"
            onClick={() => setScreen('missions')}
            aria-label={c.back}
          >
            <ArrowLeft />
          </button>
        )}
        {screen === 'closing' && <div className="planner-clock">{clockTime(now, timeLocale)}</div>}
        <div className="planner-header-copy">
          {/* Same date treatment as every other page band. */}
          <HeaderDate date={now} />
          <h1>
            {/* Phones get the short name so the header can stay on one row. */}
            <span className="planner-title-full">{heading}</span>
            <span className="planner-title-short">{heading}</span>
          </h1>
        </div>
        <div className="planner-header-actions">
          {/* The reference puts the wall clock in the header band. */}
          {screen === 'board' && (
            <span className="planner-header-clock">{clockTime(now, timeLocale)}</span>
          )}
          {screen === 'board' && (
            <button
              className="planner-icon-button"
              onClick={() => setModal('filter')}
              aria-label={c.filter}
              aria-expanded={filterOpen}
            >
              <Filter />
            </button>
          )}
          {(screen === 'board' || screen === 'child') && (
            <button
              className="planner-add"
              onClick={() => setModal('create')}
              aria-label={t('omniAdd.quickAdd')}
            >
              <Plus />
            </button>
          )}
          <span className="planner-language">
            <select
              className="planner-language-select"
              value={locale}
              onChange={(event) => onLocaleChange(event.target.value)}
              aria-label={t('settings.general.languageLabel')}
              title={t('settings.general.languageLabel')}
            >
              {LOCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </span>
          <button
            className="planner-icon-button"
            onClick={() => setPrivacy((value) => !value)}
            aria-label={c.privacy}
          >
            {privacy ? <Eye /> : <EyeOff />}
          </button>
          <button
            className="planner-icon-button"
            onClick={() => setSoundEnabled((value) => !value)}
            aria-label={c.sound}
          >
            {soundEnabled ? <Volume2 /> : <VolumeX />}
          </button>
        </div>
      </header>
      {!online && (
        <div className="planner-offline-banner" role="alert">
          {c.offline}
        </div>
      )}
      {screen === 'board' && (
        <ChoreBoard
          boardMembers={boardMembers}
          columnTasks={columnTasks}
          columnRoutines={columnRoutines}
          freeTasks={freeTasks}
          spendableFor={spendableFor}
          renderRow={renderRow}
          routineRow={routineRow}
          renderGoals={(memberId) => (
            <>
              {rewardsForMember(memberId).length === 0 && (
                <p className="planner-col-empty">{c.noRewards}</p>
              )}
              {rewardsForMember(memberId).map((reward) => renderRewardRow(reward))}
            </>
          )}
          copy={c}
          onOpenChild={(memberId) => {
            setChildMemberId(memberId);
            setScreen('child');
          }}
          onOpenGoals={openGoals}
          onStartMissions={beginMissions}
          onOpenMissions={openMissions}
          canRunMissions={canRunMissions}
          onNewChore={() => openNewForm()}
        />
      )}{' '}
      {screen === 'child' && childMember && (
        <ChildView
          childMember={childMember}
          spendableFor={spendableFor}
          columnTasks={columnTasks}
          columnRoutines={columnRoutines}
          completedTasksFor={completedTasksFor}
          completedHistory={childChoreHistory}
          formatHistoryDate={(value) =>
            new Date(value).toLocaleString(timeLocale, {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          }
          rewardsForMember={rewardsForMember}
          renderRow={renderRow}
          routineRow={routineRow}
          renderRewardRow={renderRewardRow}
          copy={c}
          onStepChild={stepChild}
          onStartMissions={beginMissions}
          onOpenMissions={openMissions}
          canRunMissions={canRunMissions}
          onNewGoal={startRewardForm}
        />
      )}{' '}
      {(screen === 'missions' || screen === 'mission' || screen === 'closing') &&
        selectedTodayMember && (
          <MissionView
            screen={screen}
            member={selectedTodayMember}
            copy={c}
            t={t}
            openTasks={openTasksFor(selectedTodayMember.id)}
            completedPoints={completedTodayPoints(selectedTodayMember.id)}
            spendable={spendableFor(selectedTodayMember)}
            currentTask={missionTask}
            currentStatus={activeMissionStatus}
            index={missionIndex}
            total={missionIds.length}
            routineStep={missionRoutineStep}
            countdown={missionTask ? countdown(missionTask.deadlineAt, now, c) : ''}
            online={online}
            busy={pendingTaskId === missionTask?.id}
            renderTask={renderTask}
            onStart={() => beginMissions(selectedTodayMember.id)}
            onComplete={() => {
              if (missionTask) void completeTask(missionTask);
            }}
            onApprove={() => {
              if (missionTask) approveTask(missionTask);
            }}
            onPass={() => {
              setScreen('board');
              setTodayMemberId(null);
            }}
          />
        )}
      {modal && (
        <div className="planner-backdrop" onClick={() => setModal(null)}>
          <section
            className={`planner-sheet ${modal === 'form' ? 'planner-sheet--form' : ''}`}
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="planner-sheet-close"
              onClick={() => setModal(null)}
              aria-label={c.cancel}
            >
              <X />
            </button>{' '}
            {modal === 'form' && (
              <ChoreEditor
                form={form}
                setForm={setForm}
                members={data.members}
                editingId={editingId}
                saving={saving}
                copy={c}
                t={t}
                routineNames={meta.routines.map((routine) => routine.name)}
                onCancel={() => setModal(null)}
                onSave={() => void saveForm()}
              />
            )}{' '}
            {modal === 'actions' && selectedTask && (
              <ActionsSheet
                completed={taskStatus(selectedTask) === 'completed'}
                copy={c}
                confirmingDelete={confirmingDelete}
                onApprove={
                  selectedTask.awaitingReview && selectedTask.actions?.approve
                    ? () => {
                        const task = selectedTask;
                        setModal(null);
                        // Signing off is a parent action: it awards the points,
                        // so it goes through the PIN, never through the child row.
                        approveTask(task);
                      }
                    : undefined
                }
                onEdit={() => openEditForm(selectedTask)}
                onDelete={() => {
                  const task = selectedTask;
                  // With a parent PIN on file, the PIN itself is the confirmation.
                  if (hasParentPin) {
                    setModal(null);
                    requestPin(c.remove, task.name, () => void removeTask(task));
                    return;
                  }
                  if (confirmingDelete) void removeTask(task);
                  else setConfirmingDelete(true);
                }}
              />
            )}{' '}
            {modal === 'award' && awardTask && (
              <AwardSheet
                task={awardTask}
                copy={c}
                t={t}
                spendable={spendableFor(memberFor(awardTask.memberId))}
                rewards={rewardsForMember(awardTask.memberId)}
                rewardState={rewardState}
                onClose={() => setModal(null)}
                onAssign={(reward) => openAssign(reward)}
                onNewGoal={() => {
                  if (awardTask.memberId) startRewardForm(awardTask.memberId);
                  else setModal('reward-form');
                }}
              />
            )}{' '}
            {modal === 'filter' && (
              <FilterSheet
                members={data.members}
                routines={data.routines}
                hiddenMemberIds={hiddenMemberIds}
                pausedRoutineIds={pausedRoutineIds}
                copy={c}
                onToggleMember={(memberId) =>
                  setHiddenMemberIds((ids) =>
                    ids.includes(memberId)
                      ? ids.filter((id) => id !== memberId)
                      : [...ids, memberId],
                  )
                }
                onToggleRoutine={toggleRoutinePaused}
                onClose={() => setModal(null)}
              />
            )}{' '}
            {modal === 'claim' && claimTask && (
              <ClaimSheet
                task={claimTask}
                options={claimOptionsFor(claimTask)}
                memberFor={memberFor}
                copy={c}
                onClaim={(option) => {
                  setModal(null);
                  void runLiveAction(
                    option.id,
                    option.actions!.claim!,
                    option.name,
                    c.claimedToast,
                  );
                }}
                onClose={() => setModal(null)}
              />
            )}{' '}
            {modal === 'goals' && goalsMember && (
              <GoalsSheet
                member={goalsMember}
                rewards={rewardsForMember(goalsMember.id)}
                copy={c}
                renderRewardRow={renderRewardRow}
                onNewGoal={startRewardForm}
                isDone={(reward) => rewardState(reward).done}
                awaiting={activeRedemptions(
                  redemptions,
                  userNameByMemberId.get(goalsMember.id) ?? null,
                ).filter((item) => item.state === 'awaiting_fulfilment')}
                given={fulfilledRedemptions(
                  redemptions,
                  goalsUserName,
                )}
                ledgerHistory={goalsLedgerHistory}
                onGive={(id) => {
                  const redemption = redemptions.find((item) => item.id === id);
                  if (redemption) giveReward(redemption);
                }}
                formatDate={(value) =>
                  new Date(value).toLocaleDateString(timeLocale, {
                    day: 'numeric',
                    month: 'short',
                  })
                }
              />
            )}{' '}
            {modal === 'create' && (
              <CreateSheet
                copy={c}
                onChore={() => openNewForm('chore')}
                onRoutine={() => openNewForm('routine')}
                onReward={() =>
                  startRewardForm(screen === 'child' ? (childMember?.id ?? undefined) : undefined)
                }
              />
            )}{' '}
            {modal === 'assign' && assigningReward && (
              <AssignPointsSheet
                reward={assigningReward}
                allocated={rewardState(assigningReward).allocated}
                spendable={spendableFor(memberByName(assigningReward.assignee))}
                copy={c}
                onCancel={() => {
                  setAssigningReward(null);
                  setModal(null);
                }}
                onAssign={(amount) => {
                  const reward = assigningReward;
                  setAssigningReward(null);
                  setModal(null);
                  assignReward(reward, amount);
                }}
              />
            )}{' '}
            {modal === 'reward-given' && givenReward && (
              <RewardGivenSheet
                rewardName={givenReward.name}
                copy={c}
                onReuse={reuseGivenReward}
                onDelete={deleteGivenReward}
              />
            )}{' '}
            {modal === 'reward-actions' && selectedReward && (
              <RewardActionsSheet
                copy={c}
                onEditCost={() => {
                  setEditingReward(selectedReward.name);
                  setRewardForm({
                    name: selectedReward.name,
                    cost: Math.round(selectedReward.cost),
                    memberIds: [],
                  });
                  setModal('reward-form');
                }}
                onDelete={() => void removeReward(selectedReward)}
              />
            )}{' '}
            {modal === 'reward-form' && (
              <RewardFormSheet
                rewardForm={rewardForm}
                setRewardForm={setRewardForm}
                editingReward={editingReward}
                members={data.members}
                saving={saving}
                copy={c}
                onCancel={() => setModal(null)}
                onSave={() => void saveReward()}
              />
            )}
          </section>
        </div>
      )}
      {confirmAction && (
        <ConfirmSheet
          action={confirmAction}
          copy={c}
          pending={pendingTaskId === confirmAction.taskId}
          onCancel={() => setConfirmAction(null)}
          onConfirm={(action) => {
            setConfirmAction(null);
            void runLiveAction(action.taskId, action.entityId, action.label, action.action);
            const task = getTask(action.taskId);
            if (
              action.kind === 'done' &&
              task?.memberId &&
              rewardsForMember(task.memberId).length > 0
            ) {
              setAwardTaskId(task.id);
              setModal('award');
            }
          }}
        />
      )}
      {pinGate && (
        <PinSheet
          gate={pinGate}
          copy={c}
          value={livePin}
          error={livePinError}
          onChange={(next) => {
            setLivePin(normalizePin(next));
            setLivePinError(false);
          }}
          onSubmit={submitPin}
          onCancel={() => setPinGate(null)}
        />
      )}
      {confetti && (
        <div
          className={`planner-confetti ${goalCelebration ? 'planner-confetti--goal' : ''}`}
          aria-hidden="true"
        >
          {Array.from({ length: 18 }, (_, index) => (
            <i key={index} style={{ '--confetti-index': index } as React.CSSProperties} />
          ))}
        </div>
      )}
      {toast && (
        <div
          className={`planner-toast planner-toast--${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
