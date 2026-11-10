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
import { resolveMemberForUser, CHOREOPS_ALL_USERS } from '../../api/choreops';
import {
  readRewardReservations,
  releasePoints,
  reservationFor,
  reservePoints,
  spendablePoints,
  writeRewardReservations,
} from '../../api/reward-reservations';
import type { RewardReservation } from '../../api/reward-reservations';
import type { ChoreOpsReward } from '../../types/choreops';
import { useChoreOps } from '../../hooks/useChoreOps';
import { useTranslation } from '../../i18n';
import { LOCALE_OPTIONS } from '../../i18n/locales';
import { normalizePin, type FamilyMember } from '../../types/family';
import { MemberAvatar } from '../MemberAvatar';
import { usePlannerCopy } from './copy';
import { RewardRow, RoutineRow, TaskRow } from './rows';
import { HeaderDate } from '../PageHeader';
import { ChoreBoard } from './ChoreBoard';
import { ChoreEditor } from './ChoreEditor';
import { ConfirmSheet, PinSheet } from './ApprovalDialog';
import {
  ActionsSheet,
  AwardSheet,
  ClaimSheet,
  FilterSheet,
  GoalsSheet,
  RewardActionsSheet,
  RewardFormSheet,
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

/** Routines paused for now (holiday, a week off) — kept per device. */
function readPausedRoutines(): string[] {
  try {
    const raw = localStorage.getItem(PAUSED_ROUTINES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writePausedRoutines(ids: string[]) {
  try {
    localStorage.setItem(PAUSED_ROUTINES_KEY, JSON.stringify(ids));
  } catch {
    /* Storage is optional. */
  }
}

interface ChorePlannerProps {
  /** Beacon family members supply photos, colours, and display names. */
  members: FamilyMember[];
  /** App language (`BeaconSettings.locale`); the planner has no own language switch. */
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
  const [now, setNow] = useState(new Date());
  /**
   * ChoreOps is the single source of truth. There is no local chore store any
   * more: the board renders exactly what the integration publishes.
   */
  const view = useMemo(
    // `now` is part of the input: a daily routine's "done" only counts for the
    // day it was completed, so the board must re-evaluate at midnight.
    () => buildChorePlannerView(choreOps.data, members, now),
    [choreOps.data, members, now],
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
  /** Members hidden from the board, and routines paused for the day. */
  const [hiddenMemberIds, setHiddenMemberIds] = useState<string[]>([]);
  const [pausedRoutineIds, setPausedRoutineIds] = useState<string[]>(() => readPausedRoutines());
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /**
   * Points a child has set aside for rewards. Kept in Beacon because ChoreOps
   * only deducts on approval, while the family wants the balance to drop as
   * soon as a reward is picked — and to be able to undo that choice.
   */
  const [reservations, setReservations] = useState<RewardReservation[]>(() =>
    readRewardReservations(),
  );
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const c = usePlannerCopy();

  useEffect(() => {
    writeRewardReservations(reservations);
  }, [reservations]);
  useEffect(() => {
    writePausedRoutines(pausedRoutineIds);
  }, [pausedRoutineIds]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
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
    if (task.awaitingReview) return c.confirm;
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
  const getTask = (id: string | null) => data.tasks.find((task) => task.id === id) ?? null;
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
  const selectedTodayMember = memberFor(todayMemberId);

  /**
   * What a child can still spend: ChoreOps' balance minus the points they have
   * set aside for rewards. `rewards` is passed in so claims made in Home
   * Assistant also count as spent (approving one still deducts them later).
   */
  const spendableFor = (member: PlannerMember | null | undefined): number => {
    if (!member) return 0;
    const userName = userNameByMemberId.get(member.id);
    if (!userName) return member.savings;
    return spendablePoints(member.savings, reservations, rewards, userName);
  };

  /**
   * A routine row: name, its part of the day, how far through it we are, and a
   * pause/resume tap. A paused routine stays visible but greyed out, so a
   * parent can see it is off and bring it back with one tap.
   */
  /** One routine row; the row component only knows what it displays. */
  const routineRow = (routine: PlannerRoutine) => {
    const paused = pausedRoutineIds.includes(routine.id);
    return (
      <RoutineRow
        key={routine.id}
        routine={routine}
        paused={paused}
        label={routineLabel(routine)}
        progress={blockProgress(routine.timeBlock)}
        copy={c}
        onToggle={() => toggleRoutinePaused(routine.id)}
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
        reserved={state.reserved !== null}
        saved={state.saved}
        available={state.available}
        pending={state.pending}
        affordable={state.affordable}
        saving={saving}
        copy={c}
        onUndo={() => undoRewardChoice(reward)}
        onConfirm={() => confirmReward(reward)}
        onApprove={() =>
          requestPin(
            c.rewards,
            reward.name,
            () => void runLiveAction(reward.id, approveId ?? '', reward.name, c.approved),
          )
        }
        onAssign={() => assignReward(reward)}
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
      ? c.claimed
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
        ? c.confirm
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
  /** A child's open chores, in the order the mission runner uses them. */
  const openTasksFor = (memberId: string) =>
    data.tasks
      .filter(
        (task) =>
          task.memberId === memberId &&
          taskStatus(task) !== 'completed' &&
          taskStatus(task) !== 'expired',
      )
      .sort(byDeadline);
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
    .filter((task) => task.audience === 'anyone' && taskStatus(task) !== 'completed')
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
    data.tasks.filter((task) => task.memberId === memberId && taskStatus(task) === 'completed');

  /** Step to the previous/next child from the detail page. */
  const stepChild = (delta: number) => {
    if (!childMember) return;
    const list = boardMembers;
    const index = list.findIndex((member) => member.id === childMember.id);
    if (index === -1) return;
    const next = list[(index + delta + list.length) % list.length];
    if (next) setChildMemberId(next.id);
  };

  /** Pause a routine so it drops out of the day until it is resumed. */
  const toggleRoutinePaused = (routineId: string) =>
    setPausedRoutineIds((ids) =>
      ids.includes(routineId) ? ids.filter((id) => id !== routineId) : [...ids, routineId],
    );

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
  const claimTask = getTask(claimTaskId);
  const childMember = memberFor(childMemberId);
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

    // The check button drives the ChoreOps action button: a claim for the child,
    // an approve when the chore is waiting for a parent.
    const entityId = task.awaitingReview
      ? task.actions?.approve
      : (task.actions?.claim ?? task.actions?.approve);
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
      if (screen === 'mission') advanceMission();
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

  /** Open the reward form with the given child already selected. */
  const startRewardForm = (memberId: string) => {
    setEditingReward(null);
    setRewardForm({ name: '', cost: 10, memberIds: [memberId] });
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
     * whose label Beacon cannot see never wipes that label. Clearing the field
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

  /** Delete a reward from ChoreOps (parent action, so PIN gated). */
  const removeReward = async (reward: ChoreOpsReward) => {
    const remove = async () => {
      try {
        setSaving(true);
        await choreOps.deleteReward(reward.name);
        setModal(null);
        showToast(toastWith(c.removedToast, reward.name));
      } catch (err) {
        showToast(err instanceof Error ? err.message : c.noFail, 'error');
      } finally {
        setSaving(false);
      }
    };
    requestPin(c.remove, reward.name, () => void remove());
  };

  /**
   * Set points aside for a reward.
   *
   * This is deliberately Beacon-only: the balance drops the moment the child
   * picks the reward, and nothing is written to ChoreOps until a parent
   * confirms it, so the child can still change their mind.
   */
  const assignReward = (reward: ChoreOpsReward) => {
    const userName =
      reward.assignee ??
      (selectedTodayMember ? userNameByMemberId.get(selectedTodayMember.id) : null);
    if (!userName) {
      showToast(c.assignToClaim, 'error');
      return;
    }
    setReservations((list) =>
      reservePoints(list, { user: userName, reward: reward.name, points: reward.cost }),
    );
    showToast(toastWith(c.assignedToast, reward.name));
  };

  /** Give the points back — the child changed their mind about this reward. */
  const undoRewardChoice = (reward: ChoreOpsReward) => {
    setReservations((list) => releasePoints(list, reward.assignee, reward.name));
    showToast(toastWith(c.undoneToast, reward.name));
  };

  /**
   * Parent confirmation in real life: ChoreOps deducts the cost once and the
   * child's allocation is released, so their visible balance does not move.
   */
  const confirmReward = (reward: ChoreOpsReward) => {
    if (!reward.assignee) {
      showToast(c.assignToClaim, 'error');
      return;
    }
    requestPin(c.rewards, reward.name, (approverName) => {
      void (async () => {
        try {
          setSaving(true);
          await choreOps.approveReward(reward.assignee as string, reward.name, approverName);
          setReservations((list) => releasePoints(list, reward.assignee, reward.name));
          playCompletionSound();
          showToast(toastWith(c.approved, reward.name));
        } catch (err) {
          showToast(err instanceof Error ? err.message : c.noFail, 'error');
        } finally {
          setSaving(false);
        }
      })();
    });
  };

  /**
   * Reward card state shared by the child screen and the rewards sheet:
   * what is set aside, whether ChoreOps has a claim pending, and what is left.
   */
  const rewardState = (reward: ChoreOpsReward) => {
    const owner = memberByName(reward.assignee);
    const reserved = reservationFor(reservations, reward.assignee, reward.name);
    const saved = owner ? spendableFor(owner) : 0;
    return {
      owner,
      reserved,
      saved,
      available: reward.status === 'available',
      pending: reward.pendingClaims > 0,
      affordable: saved >= reward.cost,
    };
  };

  /** Start the step-by-step run through one child's chores. */
  const beginMissions = (memberId: string) => {
    setTodayMemberId(memberId);
    const queue = data.tasks
      .filter(
        (task) =>
          task.memberId === memberId && !['completed', 'expired'].includes(taskStatus(task)),
      )
      .sort(byDeadline)
      .map((task) => task.id);
    setMissionIds(queue);
    setMissionIndex(0);
    setScreen(queue.length ? 'mission' : 'closing');
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
            <button className="planner-add" onClick={() => openNewForm()} aria-label={c.add}>
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
          copy={c}
          onOpenChild={(memberId) => {
            setChildMemberId(memberId);
            setScreen('child');
          }}
          onOpenGoals={openGoals}
          onStartMissions={beginMissions}
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
          rewardsForMember={rewardsForMember}
          renderRow={renderRow}
          routineRow={routineRow}
          renderRewardRow={renderRewardRow}
          copy={c}
          onStepChild={stepChild}
          onStartMissions={beginMissions}
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
            countdown={missionTask ? countdown(missionTask.deadlineAt, now, c) : ''}
            online={online}
            busy={pendingTaskId === missionTask?.id}
            renderTask={renderTask}
            onStart={() => beginMissions(selectedTodayMember.id)}
            onComplete={() => {
              if (missionTask) void completeTask(missionTask);
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
                onCancel={() => setModal(null)}
                onSave={() => void saveForm()}
              />
            )}{' '}
            {modal === 'actions' && selectedTask && (
              <ActionsSheet
                completed={taskStatus(selectedTask) === 'completed'}
                copy={c}
                confirmingDelete={confirmingDelete}
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
                onAssign={(reward) => {
                  assignReward(reward);
                  setModal(null);
                }}
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
