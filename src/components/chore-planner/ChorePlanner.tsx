import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clock3,
  Eye,
  EyeOff,
  ListPlus,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  ChorePlannerState,
  PlannerTask,
  getPlannerTaskStatus,
} from '../../api/chore-planner-model';
import type { PlannerMember } from '../../api/chore-planner-model';
import { buildChorePlannerView } from '../../api/chore-planner-view';
import { resolveMemberForUser } from '../../api/choreops';
import { FamilyStore } from '../../api/family';
import { localDayKey } from '../../api/date-keys';
import { routineAvailableAt, routineOccursOnDate } from '../../api/routine-schedule';
import {
  activeRedemptions,
  fulfilledRedemptions,
  spendableWithRedemptions,
} from '../../api/reward-redemptions';
import type { ChoreOpsReward } from '../../types/choreops';
import { recordDebugLog } from '../../api/debug-log';
import { useChoreOps } from '../../hooks/useChoreOps';
import type { ChoreProvider } from '../../api/choresman';
import { useRewardRedemptions } from '../../hooks/useRewardRedemptions';
import { useRoutines } from '../../hooks/useRoutines';
import { useTranslation } from '../../i18n';
import {
  DEFAULT_ROUTINE_MISSION_POINTS,
  normalizePin,
  type FamilyMember,
  type Routine as FamilyRoutine,
} from '../../types/family';
import { MemberAvatar } from '../MemberAvatar';
import { ActivitySpinner, LoadingPlaceholder } from '../LoadingPlaceholder';
import { usePlannerCopy } from './copy';
import { FamilyRoutineRow, RewardRow, TaskRow, type RoutineStep } from './rows';
import { HeaderDate, PageHeaderActions } from '../PageHeader';
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
import { usePlannerHistory } from './usePlannerHistory';
import { useChoreFormActions } from './useChoreFormActions';
import { usePlannerRewards } from './usePlannerRewards';
import { errorDiagnosticText } from './planner-utils';
import { MIN_PIN_LENGTH, clockTime, countdown, emptyForm, toastWith, type FormValue } from './form';
import { initialPlannerOverlay, plannerOverlayReducer } from './overlay-state';
import { RoutineEditorDialog } from '../routines/RoutineEditorDialog';
import type { RoutineEditorRequest } from '../routines/RoutineEditorDialog';

/**
 * The planner is one board: routines for every family member and chore lists
 * for children. Missions guide a member through the same Family routine.
 */
type Screen = 'board' | 'child' | 'missions' | 'mission' | 'closing';

/** Outcome shown in the bottom-right notification. */
type ToastKind = 'success' | 'error';

interface ChorePlannerProps {
  /** Abbai Flow family members supply photos, colours, and display names. */
  members: FamilyMember[];
  provider?: ChoreProvider;
  /** App language (`AbbaiSettings.locale`), used by the routine editor. */
  locale: string;
  weekStartsOn?: 0 | 1;
  /**
   * Asks the planner to open its new chore form from quick add.
   */
  createRequest?: { kind: 'chore' | 'routine'; token: number };
}

export function ChorePlanner({
  members,
  provider = 'choreops',
  locale,
  weekStartsOn = 1,
  createRequest,
}: ChorePlannerProps) {
  const choreOps = useChoreOps(provider, provider === 'choresman' ? members : []);
  const routinesApi = useRoutines();
  const {
    routines: familyRoutines,
    isTaskCompletedToday: isRoutineTaskCompletedToday,
    refresh: refreshRoutines,
    toggleTask: toggleRoutineTask,
  } = routinesApi;
  const familyStore = useMemo(() => new FamilyStore(), []);
  const [now, setNow] = useState(new Date());
  /** ChoreOps owns chore data; routines come from the Family store. */
  const choreFamily = useMemo(
    () => provider === 'choresman'
      ? members.map((member) => {
          const localMember = { ...member };
          delete localMember.choreops_user;
          return localMember;
        })
      : members,
    [members, provider],
  );
  const view = useMemo(
    () => buildChorePlannerView(choreOps.data, choreFamily, now),
    [choreOps.data, choreFamily, now],
  );
  const plannerMembers = [...view.members];
  for (const familyMember of members) {
    if (
      (familyMember.role === 'parent' ||
        familyRoutines.some((routine) => routine.member_id === familyMember.id)) &&
      !plannerMembers.some((plannerMember) => plannerMember.id === familyMember.id)
    ) {
      plannerMembers.push({
        id: familyMember.id,
        name: familyMember.name,
        avatar: familyMember.avatar,
        role: familyMember.role,
        photo: familyMember.photo,
        color: familyMember.color,
        savings: familyMember.choreops_state?.points ?? 0,
      });
    }
  }
  const data: ChorePlannerState = {
    members: plannerMembers,
    tasks: view.tasks,
    goals: view.goals,
    routines: [],
    routinesPaused: false,
    soundEnabled: true,
  };
  const { lang, dateLocale, t } = useTranslation();
  /** Tag for `toLocaleTimeString`/`toLocaleDateString` — follows the app locale. */
  const timeLocale = dateLocale.code || lang;
  const [screen, setScreen] = useState<Screen>('board');
  const [overlay, dispatchOverlay] = useReducer(plannerOverlayReducer, initialPlannerOverlay);
  const [routineEditorRequest, setRoutineEditorRequest] = useState<RoutineEditorRequest | null>(
    null,
  );
  const modal = overlay.type === 'closed' ? null : overlay.type;
  const [form, setForm] = useState<FormValue>(() => emptyForm(new Date()));
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
  const [celebration, setCelebration] = useState<'chore' | 'goal' | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [todayMemberId, setTodayMemberId] = useState<string | null>(null);
  /** Child whose detail page is open (the board is the overview). */
  const [childMemberId, setChildMemberId] = useState<string | null>(null);
  /** Members hidden from the board, and the child whose mission run is open. */
  const [hiddenMemberIds, setHiddenMemberIds] = useState<string[]>([]);
  const [missionIds, setMissionIds] = useState<string[]>([]);
  const [missionIndex, setMissionIndex] = useState(0);
  const [missionBonusPoints, setMissionBonusPoints] = useState(0);
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
  /**
   * Reward progress (saving → achieved → given). Shared through abbai-flow-store:
   * ChoreOps owns the definition and the deduction, not the pursuit.
   */
  const rewardsState = useRewardRedemptions();
  const redemptions = rewardsState.redemptions;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const c = usePlannerCopy();
  const openRoutineEditor = (routine?: FamilyRoutine, memberId?: string) => {
    setRoutineEditorRequest((current) => ({
      token: (current?.token ?? 0) + 1,
      routine,
      memberId: memberId ?? routine?.member_id,
    }));
  };
  useEffect(() => {
    if (!createRequest || createRequest.token === 0 || createRequest.kind !== 'routine') return;
    dispatchOverlay({ type: 'close' });
    openRoutineEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new request token opens once
  }, [createRequest?.token]);

  const familyMissionTasks = useMemo<PlannerTask[]>(
    () =>
      familyRoutines
        .filter((routine) => routineOccursOnDate(routine, now))
        .flatMap((routine) =>
          [...routine.tasks]
            .sort((a, b) => a.order - b.order)
            .map((task) => ({
              id: `family-routine:${routine.id}:${task.id}`,
              name: task.name,
              icon: null,
              points: 0,
              memberId: routine.member_id,
              kind: 'task' as const,
              startsAt: now.toISOString(),
              deadlineAt: null,
              expiresAt: null,
              retryMinutes: null,
              timeBlock: routine.time_of_day,
              statusOverride: isRoutineTaskCompletedToday(routine.id, task.id, routine.member_id)
                ? ('completed' as const)
                : ('active' as const),
              audience: 'member' as const,
              routineId: routine.id,
              routineName: routine.name,
              familyRoutineTask: { routineId: routine.id, taskId: task.id },
            })),
        ),
    [now, familyRoutines, isRoutineTaskCompletedToday],
  );

  /** A save that only reached this device must never look like it was stored. */
  useEffect(() => {
    const failure = rewardsState.error;
    if (failure) showToast(`${c.noFail}: ${failure}`, 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on change
  }, [rewardsState.error]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => void refreshRoutines(), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshRoutines]);
  useEffect(() => {
    if (!toast) return;
    // Errors stay a little longer: a parent needs time to read what ChoreOps
    // rejected, successes are just a confirmation.
    const timer = setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(null), celebration === 'goal' ? 2400 : 1800);
    return () => clearTimeout(timer);
  }, [celebration]);

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

  const openActions = (taskId: string, fromRoutine = false) => {
    dispatchOverlay({ type: 'open-actions', taskId, fromRoutine });
  };

  /** Planner member id → ChoreOps user name, for writing back to ChoreOps. */
  const userNameByMemberId = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of choreOps.data?.users ?? []) {
      const member = resolveMemberForUser(user.name, members);
      map.set(member ? member.id : `choreops:${user.name.trim().toLowerCase()}`, user.name);
    }
    for (const member of members) {
      const linkedUser = choreOps.data?.users.find(
        (user) => user.name.trim().toLowerCase() === member.choreops_user?.trim().toLowerCase(),
      );
      if (linkedUser) map.set(member.id, linkedUser.name);
    }
    return map;
  }, [choreOps.data, members]);
  const getTask = (id: string | null) =>
    data.tasks.find((task) => task.id === id) ??
    view.allTasks.find((task) => task.id === id) ??
    familyMissionTasks.find((task) => task.id === id) ??
    null;
  const memberFor = (id: string | null) => data.members.find((member) => member.id === id) ?? null;
  const editingId = overlay.type === 'form' ? overlay.editingId : null;
  const editingReward = overlay.type === 'reward-form' ? overlay.editingReward : null;
  const actionsOverlay = overlay.type === 'actions' ? overlay : null;
  const selectedTask = actionsOverlay ? getTask(actionsOverlay.taskId) : null;
  const claimTask = overlay.type === 'claim' ? getTask(overlay.taskId) : null;
  const awardTask = overlay.type === 'award' ? getTask(overlay.taskId) : null;
  const goalsMember = overlay.type === 'goals' ? memberFor(overlay.memberId) : null;
  const selectedReward = overlay.type === 'reward-actions' ? overlay.reward : null;
  const assigningReward = overlay.type === 'assign' ? overlay.reward : null;
  const givenReward = overlay.type === 'reward-given' ? { name: overlay.name } : null;
  /** ChoreOps rewards, one entry per user+reward (that is how it publishes them). */
  const rewards = choreOps.data?.rewards ?? [];
  const goalMembers = data.members.filter((member) => member.role === 'child');
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
    const link = missionTask?.familyRoutineTask;
    if (!link) return null;
    const routine = familyRoutines.find((item) => item.id === link.routineId);
    if (!routine) return null;
    const orderedTasks = [...routine.tasks].sort((a, b) => a.order - b.order);
    return {
      name: routine.name,
      index: orderedTasks.findIndex((task) => task.id === link.taskId) + 1,
      total: orderedTasks.length,
      timeOfDay: routine.time_of_day,
      available: routineAvailableAt(routine, now),
    };
  })();
  const selectedTodayMember = memberFor(todayMemberId);

  /**
   * What a family member can still spend: ChoreOps' balance minus the points already
   * promised to a reward. `rewards` is passed in so claims made in Home
   * Assistant also count as spent (approving one still deducts them later).
   */
  const spendableFor = (member: PlannerMember | null | undefined): number => {
    if (!member) return 0;
    const userName = userNameByMemberId.get(member.id);
    if (!userName) return member.savings;
    return spendableWithRedemptions(member.savings, redemptions, rewards, userName);
  };

  /** One Abbai Flow routine row for its assigned family member. */
  const routineRow = (routine: FamilyRoutine, memberId: string) => {
    const steps = routineStepsFor(routine, memberId);
    const canEarnMissionPoints = isChildMember(memberId);
    const bonusPoints = Math.max(
      0,
      canEarnMissionPoints ? (routine.mission_points ?? DEFAULT_ROUTINE_MISSION_POINTS) : 0,
    );
    return (
      <FamilyRoutineRow
        key={routine.id}
        routine={routine}
        label={routineLabel(routine)}
        bonusPoints={bonusPoints}
        steps={steps}
        copy={c}
        onStart={canEarnMissionPoints ? () => beginRoutine(memberId, routine.id) : undefined}
        onEdit={() => openRoutineEditor(routine, memberId)}
        onDelete={() => void routinesApi.removeRoutine(routine.id)}
        canStart={
          steps.some((step) => step.open) &&
          (bonusPoints === 0 || Boolean(userNameByMemberId.get(memberId)))
        }
        busyTaskId={pendingTaskId}
        onCompleteStep={(taskId) => {
          const task = getTask(taskId);
          if (task) void completeFamilyRoutineTask(task, false);
        }}
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
          dispatchOverlay({ type: 'open-reward-actions', reward });
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
  /** Family-owned routines with unfinished steps for this member. */
  const missionsFor = (memberId: string) =>
    (isChildMember(memberId) ? columnRoutines(memberId) : [])
      .filter(
        (routine) =>
          Boolean(userNameByMemberId.get(memberId)) ||
          (routine.mission_points ?? DEFAULT_ROUTINE_MISSION_POINTS) <= 0,
      )
      .map((routine) => ({
        routine,
        tasks: routineTasksFor(routine, memberId),
      }))
      .filter((entry) => entry.tasks.length > 0);

  function routineTasksFor(routine: FamilyRoutine, memberId: string): PlannerTask[] {
    if (!routineAvailableAt(routine, now)) return [];
    return [...routine.tasks]
      .sort((a, b) => a.order - b.order)
      .filter((task) => !isRoutineTaskCompletedToday(routine.id, task.id, memberId))
      .map((task) =>
        familyMissionTasks.find(
          (plannerTask) =>
            plannerTask.familyRoutineTask?.taskId === task.id &&
            plannerTask.familyRoutineTask?.routineId === routine.id,
        ),
      )
      .filter((task): task is PlannerTask => Boolean(task));
  }

  function routineStepsFor(routine: FamilyRoutine, memberId: string): RoutineStep[] {
    const available = routineAvailableAt(routine, now);
    return [...routine.tasks]
      .sort((a, b) => a.order - b.order)
      .map((step) => {
        const done = isRoutineTaskCompletedToday(routine.id, step.id, memberId);
        return {
          name: step.name,
          ...(!done && available ? { taskId: `family-routine:${routine.id}:${step.id}` } : {}),
          done,
          open: !done && available,
        };
      });
  }

  const canRunMissions = (memberId: string) => missionsFor(memberId).length > 0;
  const byDeadline = (a: PlannerTask, b: PlannerTask) =>
    new Date(a.deadlineAt ?? a.expiresAt ?? a.startsAt).getTime() -
    new Date(b.deadlineAt ?? b.expiresAt ?? b.startsAt).getTime();

  /**
   * Open chores on one child's column: late ones first, then by deadline.
   * Chores still up for grabs are excluded here — they belong to the free
   * column until somebody takes one.
   */
  const isChildMember = (memberId: string) =>
    members.find((member) => member.id === memberId)?.role !== 'parent';

  const columnTasks = (memberId: string) => {
    if (!isChildMember(memberId)) return [];
    return data.tasks
      .filter(
        (task) =>
          task.memberId === memberId &&
          task.audience !== 'anyone' &&
          !['completed', 'expired'].includes(taskStatus(task)),
      )
      .sort((a, b) => {
        const late = (task: PlannerTask) => (['late', 'retry'].includes(taskStatus(task)) ? 0 : 1);
        return late(a) - late(b) || byDeadline(a, b);
      });
  };

  /**
   * Chores still up for grabs. ChoreOps publishes one row per user for a
   * first-come-first-served chore, so the board shows the chore once and asks
   * which child is taking it when somebody taps it.
   */
  const freeTasks = [...data.tasks]
    .filter(
      (task) =>
        task.audience === 'anyone' &&
        task.memberId !== null &&
        isChildMember(task.memberId) &&
        taskStatus(task) !== 'completed',
    )
    .filter((task, index, all) => all.findIndex((other) => other.name === task.name) === index)
    .sort(byDeadline);

  /** Every row of one free chore, i.e. one claim button per child. */
  const claimOptionsFor = (task: PlannerTask) =>
    data.tasks.filter(
      (other) =>
        other.name === task.name &&
        other.audience === 'anyone' &&
        other.actions?.claim &&
        Boolean(other.memberId && isChildMember(other.memberId)),
    );

  /** Open the "who is taking this?" sheet for a free chore. */
  const openClaim = (task: PlannerTask) => {
    dispatchOverlay({ type: 'open-claim', taskId: task.id });
  };

  /** Family Settings is the only routine registry. */
  const columnRoutines = (memberId: string) =>
    familyRoutines.filter(
      (routine) => routine.member_id === memberId && routineOccursOnDate(routine, now),
    );

  /** Columns on the board: the ones a parent has not filtered out. */
  const boardMembers = data.members.filter((member) => !hiddenMemberIds.includes(member.id));

  /** Completed chores of one child today (the detail page's history). */
  const completedTasksFor = (memberId: string) =>
    isChildMember(memberId)
      ? data.tasks.filter((task) => task.memberId === memberId && taskStatus(task) === 'completed')
      : [];

  /** Step to the previous/next child from the detail page. */
  const stepChild = (delta: number) => {
    if (!childMember) return;
    const list = boardMembers;
    const index = list.findIndex((member) => member.id === childMember.id);
    if (index === -1) return;
    const next = list[(index + delta + list.length) % list.length];
    if (next) setChildMemberId(next.id);
  };

  /**
   * The award sheet asks where the earned points should go as soon as a chore is ticked.
   * We do the same: complete the chore, then offer this child's goals.
   */
  /** Localized time of day under a routine name. */
  const routineLabel = (routine: FamilyRoutine) => {
    const block =
      routine.time_of_day === 'morning'
        ? c.morning
        : routine.time_of_day === 'evening'
          ? c.evening
          : c.afternoon;
    return block;
  };

  /** Open the goal sheet of one child, where their rewards live. */
  const openGoals = (memberId: string) => {
    dispatchOverlay({ type: 'open-goals', memberId });
  };
  const goalsUserName = goalsMember ? (userNameByMemberId.get(goalsMember.id) ?? null) : null;
  const childMember = memberFor(childMemberId);
  const childUserName = childMember ? (userNameByMemberId.get(childMember.id) ?? null) : null;
  const { goalsLedgerHistory, childChoreHistory } = usePlannerHistory({
    goalsOpen: modal === 'goals',
    goalsUserName,
    childViewOpen: screen === 'child',
    childUserName,
    chores: choreOps.data?.chores ?? [],
    choreOpsAvailable: choreOps.available,
  });
  /** The filter sheet doubles as the board's filter state indicator. */
  const filterOpen = modal === 'filter';

  const showToast = (message: string, kind: ToastKind = 'success', details?: string) => {
    setToast({ message, kind });
    if (kind === 'error') {
      recordDebugLog({
        level: 'error',
        source: 'Chore Planner',
        message,
        details: details ?? message,
      });
    }
  };

  const showError = (error: unknown) => {
    const message = error instanceof Error ? error.message : c.noFail;
    showToast(message, 'error', errorDiagnosticText(error));
  };

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

  const completeFamilyRoutineTask = async (task: PlannerTask, asMission: boolean) => {
    const link = task.familyRoutineTask;
    if (!link || pendingTaskId) return;
    const routine = familyRoutines.find((item) => item.id === link.routineId);
    if (
      !routine ||
      !routineAvailableAt(routine, new Date()) ||
      isRoutineTaskCompletedToday(routine.id, link.taskId, routine.member_id)
    ) {
      return;
    }

    setPendingTaskId(task.id);
    let completionSaved = false;
    try {
      const persisted = await toggleRoutineTask(routine, link.taskId);
      if (!persisted) throw new Error('Could not save this routine task completion');
      completionSaved = true;
      const missionFinished =
        asMission &&
        routine.tasks.every(
          (step) =>
            step.id === link.taskId ||
            isRoutineTaskCompletedToday(routine.id, step.id, routine.member_id),
        );
      const bonus = Math.max(0, routine.mission_points ?? DEFAULT_ROUTINE_MISSION_POINTS);
      let bonusGranted = false;

      if (missionFinished && bonus > 0) {
        const userName = userNameByMemberId.get(routine.member_id);
        if (!userName) {
          throw new Error('Link this family member to a ChoreOps user to award mission points');
        }
        const date = localDayKey();
        const claimed = await familyStore.claimRoutineMissionBonus(
          routine.id,
          routine.member_id,
          date,
        );
        if (claimed) {
          try {
            await choreOps.adjustPoints(
              userName,
              bonus,
              `Abbai Flow mission: ${routine.name} (${date})`,
            );
            setMissionBonusPoints((previous) => previous + bonus);
            bonusGranted = true;
            setCelebration('chore');
            showToast(`${routine.name} +${bonus} ⭐`);
          } catch (error) {
            await familyStore.releaseRoutineMissionBonus(routine.id, routine.member_id, date);
            throw error;
          }
        }
      }

      playCompletionSound();
      if (!bonusGranted) showToast(toastWith(c.done, task.name));
      if (asMission) advanceMission();
    } catch (error) {
      showError(error);
      if (completionSaved && asMission) advanceMission();
    } finally {
      setPendingTaskId(null);
    }
  };

  const completeTask = async (task: PlannerTask) => {
    if (task.familyRoutineTask) {
      void completeFamilyRoutineTask(task, true);
      return;
    }
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
  const runLiveAction = async (
    taskId: string,
    entityId: string,
    label: string,
    action: string,
    celebrate?: 'chore' | 'goal',
  ) => {
    if (pendingTaskId) return;
    setPendingTaskId(taskId);
    try {
      await choreOps.pressButton(entityId);
      if (celebrate) setCelebration(celebrate);
      playCompletionSound();
      showToast(toastWith(action, label));
    } catch (err) {
      showError(err);
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

  const { openNewForm, openEditForm, saveForm, removeTask, reuseTask } = useChoreFormActions({
    form,
    setForm,
    editingId,
    saving,
    setSaving,
    now,
    choreOps,
    getTask,
    userNameByMemberId,
    hasParentPin,
    requestPin,
    dispatchOverlay,
    showToast,
    showError,
    copy: c,
    t,
    createRequest,
  });
  const requestUseAgain = (task: PlannerTask) => {
    dispatchOverlay({ type: 'close' });
    requestPin(c.useAgain, task.name, () => void reuseTask(task));
  };
  const {
    rewardForm,
    setRewardForm,
    memberByName,
    rewardsForMember,
    memberIdsForReward,
    startRewardForm,
    saveReward,
    removeReward,
    openAssign,
    assignReward,
    undoRewardChoice,
    giveReward,
    reuseGivenReward,
    deleteGivenReward,
    rewardState,
  } = usePlannerRewards({
    choreOps,
    rewardsState,
    rewards,
    redemptions,
    members: data.members,
    userNameByMemberId,
    selectedTodayMember,
    spendableFor,
    editingReward,
    givenRewardName: givenReward?.name ?? null,
    saving,
    setSaving,
    setCelebration,
    requestPin,
    dispatchOverlay,
    showToast,
    showError,
    copy: c,
  });

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
      () => void runLiveAction(task.id, entityId, task.name, c.approved, 'chore'),
    );
  };

  /**
   * Open the reward form. A child's goals sheet preselects that child; the
   * header create menu starts empty and lets the parent pick who gets it.
   */
  /** Start one routine as a guided mission. */
  const beginRoutine = (memberId: string, routineId: string) => {
    if (!isChildMember(memberId)) return;
    const routine = familyRoutines.find((item) => item.id === routineId);
    if (!routine || !routineAvailableAt(routine, new Date())) return;
    const steps = routineTasksFor(routine, memberId);
    setTodayMemberId(memberId);
    setMissionBonusPoints(0);
    if (steps.length === 0) {
      setMissionIds([]);
      setMissionIndex(0);
      setScreen('closing');
      return;
    }
    setMissionIds(steps.map((task) => task.id));
    setMissionIndex(0);
    setScreen('mission');
  };

  /**
   * Let the child choose one available routine before starting its mission.
   */
  const openMissions = (memberId: string) => {
    setTodayMemberId(memberId);
    setMissionIds([]);
    setMissionIndex(0);
    setMissionBonusPoints(0);
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
          aria-busy={pendingTaskId === task.id}
          onClick={() => void completeTask(task)}
        >
          {/* Pill action with the points in its own coloured segment — the
              family-planner "Afvinken maar! | 🏆 25" pattern. The label names
              the action the tap performs, so a claimed chore reads "Approve",
              not "Completed". */}
          <span className="planner-check-label">{pillLabel(task, status)}</span>
          <span className="planner-check-icon" aria-hidden="true">
            {pendingTaskId === task.id ? (
              <ActivitySpinner />
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
        <PageHeaderActions
          className="page-header-actions planner-header-actions"
          clock={
            screen === 'board' ? (
              <span className="planner-header-clock">{clockTime(now, timeLocale)}</span>
            ) : null
          }
        >
          {screen === 'board' && (
            <button
              className="planner-icon-button"
              onClick={() => dispatchOverlay({ type: 'open-filter' })}
              aria-label={c.filter}
              aria-expanded={filterOpen}
            >
              <SlidersHorizontal />
            </button>
          )}
          {(screen === 'board' || (screen === 'child' && childMember?.role !== 'parent')) && (
            <button
              className="planner-add"
              onClick={() => dispatchOverlay({ type: 'open-create' })}
              aria-label={c.chooseWhat}
            >
              <ListPlus />
            </button>
          )}
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
        </PageHeaderActions>
      </header>
      {!online && (
        <div className="planner-offline-banner" role="alert">
          {c.offline}
        </div>
      )}
      {screen === 'board' && choreOps.loading && !choreOps.data && (
        <div className="planner-loading-board" aria-label={t('planner.loading')} role="status">
          {Array.from(
            { length: Math.max(2, Math.min(data.members.length || 3, 4)) },
            (_, index) => (
              <section className="planner-loading-column" key={index} aria-hidden="true">
                <LoadingPlaceholder
                  label={t('planner.loading')}
                  lines={1}
                  className="loading-placeholder--compact"
                  widths={[64]}
                />
                <LoadingPlaceholder label={t('planner.loading')} lines={3} widths={[91, 76, 58]} />
              </section>
            ),
          )}
        </div>
      )}
      {screen === 'board' && !(choreOps.loading && !choreOps.data) && (
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
          onStartMissions={openMissions}
          onOpenMissions={openMissions}
          canRunMissions={canRunMissions}
          onNewChore={() => openNewForm()}
          onNewRoutine={(memberId) => openRoutineEditor(undefined, memberId)}
          onNewGoal={startRewardForm}
        />
      )}{' '}
      {screen === 'child' && childMember && (
        <ChildView
          childMember={childMember}
          isParent={childMember.role === 'parent'}
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
          onStartMissions={openMissions}
          onOpenMissions={openMissions}
          canRunMissions={canRunMissions}
          onNewGoal={startRewardForm}
          onNewRoutine={(memberId) => openRoutineEditor(undefined, memberId)}
        />
      )}{' '}
      {(screen === 'missions' || screen === 'mission' || screen === 'closing') &&
        selectedTodayMember && (
          <MissionView
            screen={screen}
            member={selectedTodayMember}
            copy={c}
            t={t}
            routines={missionsFor(selectedTodayMember.id)}
            completedPoints={completedTodayPoints(selectedTodayMember.id) + missionBonusPoints}
            spendable={spendableFor(selectedTodayMember)}
            currentTask={missionTask}
            currentStatus={activeMissionStatus}
            index={missionIndex}
            total={missionIds.length}
            routineStep={missionRoutineStep}
            onStartRoutine={(routineId) => beginRoutine(selectedTodayMember.id, routineId)}
            countdown={missionTask ? countdown(missionTask.deadlineAt, now, c) : ''}
            online={online && (missionRoutineStep?.available ?? true)}
            busy={pendingTaskId === missionTask?.id}
            renderTask={renderTask}
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
      {overlay.type !== 'closed' && (
        <div className="planner-backdrop" onClick={() => dispatchOverlay({ type: 'close' })}>
          <section
            className={`planner-sheet ${overlay.type === 'form' ? 'planner-sheet--form' : ''}`}
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="planner-sheet-close"
              onClick={() => dispatchOverlay({ type: 'close' })}
              aria-label={c.cancel}
            >
              <X />
            </button>{' '}
            {overlay.type === 'form' && (
              <ChoreEditor
                form={form}
                setForm={setForm}
                members={
                  !overlay.editingId &&
                  screen === 'child' &&
                  childMember &&
                  isChildMember(childMember.id)
                    ? [childMember]
                    : data.members.filter((member) => isChildMember(member.id))
                }
                editingId={overlay.editingId}
                saving={saving}
                copy={c}
                t={t}
                onCancel={() => dispatchOverlay({ type: 'close' })}
                onSave={() => void saveForm()}
              />
            )}{' '}
            {actionsOverlay && selectedTask && (
              <ActionsSheet
                completed={taskStatus(selectedTask) === 'completed' && !actionsOverlay.fromRoutine}
                copy={c}
                confirmingDelete={actionsOverlay.confirmingDelete}
                onUseAgain={
                  taskStatus(selectedTask) === 'completed'
                    ? () => requestUseAgain(selectedTask)
                    : undefined
                }
                onApprove={
                  selectedTask.awaitingReview && selectedTask.actions?.approve
                    ? () => {
                        const task = selectedTask;
                        dispatchOverlay({ type: 'close' });
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
                    dispatchOverlay({ type: 'close' });
                    requestPin(c.remove, task.name, () => void removeTask(task));
                    return;
                  }
                  if (actionsOverlay.confirmingDelete) void removeTask(task);
                  else dispatchOverlay({ type: 'confirm-delete' });
                }}
              />
            )}{' '}
            {awardTask && (
              <AwardSheet
                task={awardTask}
                copy={c}
                t={t}
                rewards={rewardsForMember(awardTask.memberId)}
                rewardState={rewardState}
                onAssign={(reward) => openAssign(reward)}
                onNewGoal={() => startRewardForm(awardTask.memberId ?? undefined)}
              />
            )}{' '}
            {overlay.type === 'filter' && (
              <FilterSheet
                members={data.members}
                hiddenMemberIds={hiddenMemberIds}
                copy={c}
                onToggleMember={(memberId) =>
                  setHiddenMemberIds((ids) =>
                    ids.includes(memberId)
                      ? ids.filter((id) => id !== memberId)
                      : [...ids, memberId],
                  )
                }
                onClose={() => dispatchOverlay({ type: 'close' })}
              />
            )}{' '}
            {claimTask && (
              <ClaimSheet
                task={claimTask}
                options={claimOptionsFor(claimTask)}
                memberFor={memberFor}
                copy={c}
                onClaim={(option) => {
                  dispatchOverlay({ type: 'close' });
                  void runLiveAction(
                    option.id,
                    option.actions!.claim!,
                    option.name,
                    c.claimedToast,
                  );
                }}
                onClose={() => dispatchOverlay({ type: 'close' })}
              />
            )}{' '}
            {goalsMember && (
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
                given={fulfilledRedemptions(redemptions, goalsUserName)}
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
            {overlay.type === 'create' && (
              <CreateSheet
                copy={c}
                chores={(choreOps.data?.chores ?? []).filter((chore) =>
                  view.allTasks.some(
                    (task) =>
                      task.name.trim().toLowerCase() === chore.name.trim().toLowerCase() &&
                      task.memberId !== null &&
                      isChildMember(task.memberId),
                  ),
                )}
                tasks={view.allTasks}
                routines={familyRoutines}
                rewards={rewards}
                members={data.members}
                onRoutine={() => {
                  dispatchOverlay({ type: 'close' });
                  openRoutineEditor();
                }}
                onEditRoutine={(routine) => {
                  dispatchOverlay({ type: 'close' });
                  openRoutineEditor(routine, routine.member_id);
                }}
                onDeleteRoutine={(routine) => void routinesApi.removeRoutine(routine.id)}
                onChore={() =>
                  openNewForm(
                    screen === 'child' && childMember && isChildMember(childMember.id)
                      ? childMember.id
                      : undefined,
                  )
                }
                onReward={() =>
                  startRewardForm(screen === 'child' ? (childMember?.id ?? undefined) : undefined)
                }
                onEditChore={openEditForm}
                onOpenTaskActions={(task) => openActions(task.id, task.inRoutine)}
                onUseAgain={requestUseAgain}
                onOpenReward={(reward) => dispatchOverlay({ type: 'open-reward-actions', reward })}
              />
            )}{' '}
            {assigningReward && (
              <AssignPointsSheet
                reward={assigningReward}
                allocated={rewardState(assigningReward).allocated}
                spendable={spendableFor(memberByName(assigningReward.assignee))}
                saving={saving}
                copy={c}
                onCancel={() => dispatchOverlay({ type: 'close' })}
                onAssign={(amount) => {
                  void assignReward(assigningReward, amount);
                }}
              />
            )}{' '}
            {givenReward && (
              <RewardGivenSheet
                rewardName={givenReward.name}
                copy={c}
                onReuse={reuseGivenReward}
                onDelete={deleteGivenReward}
              />
            )}{' '}
            {selectedReward && (
              <RewardActionsSheet
                copy={c}
                onEdit={() => {
                  setRewardForm({
                    name: selectedReward.name,
                    cost: Math.round(selectedReward.cost),
                    memberIds: memberIdsForReward(selectedReward.name),
                  });
                  dispatchOverlay({
                    type: 'open-reward-form',
                    editingReward: selectedReward.name,
                  });
                }}
                onDelete={() => void removeReward(selectedReward)}
              />
            )}{' '}
            {overlay.type === 'reward-form' && (
              <RewardFormSheet
                rewardForm={rewardForm}
                setRewardForm={setRewardForm}
                editingReward={overlay.editingReward}
                members={
                  overlay.editingReward || screen !== 'child' || !childMember
                    ? goalMembers
                    : goalMembers.filter((member) => member.id === childMember.id)
                }
                saving={saving}
                copy={c}
                onCancel={() => dispatchOverlay({ type: 'close' })}
                onSave={() => void saveReward()}
              />
            )}
          </section>
        </div>
      )}
      {routineEditorRequest && (
        <RoutineEditorDialog
          key={routineEditorRequest.token}
          request={routineEditorRequest}
          members={members}
          locale={locale}
          weekStartsOn={weekStartsOn}
          onClose={() => setRoutineEditorRequest(null)}
          onSaved={refreshRoutines}
        />
      )}
      {confirmAction && (
        <ConfirmSheet
          action={confirmAction}
          copy={c}
          pending={pendingTaskId === confirmAction.taskId}
          onCancel={() => setConfirmAction(null)}
          onConfirm={(action) => {
            setConfirmAction(null);
            void runLiveAction(
              action.taskId,
              action.entityId,
              action.label,
              action.action,
              action.kind === 'done' ? 'chore' : undefined,
            );
            const task = getTask(action.taskId);
            if (
              action.kind === 'done' &&
              task?.memberId &&
              rewardsForMember(task.memberId).length > 0
            ) {
              dispatchOverlay({ type: 'open-award', taskId: task.id });
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
      {celebration && (
        <div className={`planner-confetti planner-confetti--${celebration}`} aria-hidden="true">
          {Array.from({ length: celebration === 'goal' ? 54 : 36 }, (_, index) => (
            <i
              key={index}
              style={
                {
                  '--confetti-index': index,
                  '--confetti-x': `${(index * 37) % 100}%`,
                  '--confetti-delay': `${(index % 8) * 0.045}s`,
                } as React.CSSProperties
              }
            />
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
