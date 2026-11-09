import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  Filter,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
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
import {
  resolveMemberForUser,
  CHOREOPS_ALL_USERS,
  CHOREOPS_FREQUENCIES,
  CHOREOPS_INTERVAL_UNITS,
} from '../../api/choreops';
import type { ChoreOpsFrequency, ChoreOpsIntervalUnit } from '../../api/choreops';
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
import {
  DAY_KEYS,
  FREQUENCY_KEY,
  MIN_PIN_LENGTH,
  UNIT_KEY,
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
        ? { ...emptyForm(now), frequency: 'daily', liveFrequency: 'daily', timeBlock: 'morning' }
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

    const frequency = form.liveFrequency;
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

  const memberTodayCount = (id: string) =>
    data.tasks.filter(
      (task) =>
        task.memberId === id && taskStatus(task) !== 'completed' && taskStatus(task) !== 'expired',
    ).length;
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
          {/* Board hero: a small line with the date above the page title. */}
          <span className="planner-eyebrow">
            {now.toLocaleDateString(timeLocale, { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
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
                    onClick={() => {
                      setChildMemberId(member.id);
                      setScreen('child');
                    }}
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
                    onClick={() => openGoals(member.id)}
                    aria-label={`${c.goals}: ${member.name}`}
                  >
                    <span aria-hidden="true">{'\u{1FA99}'}</span>
                    {spendableFor(member)}
                  </button>
                  <button
                    type="button"
                    className="planner-col-play"
                    disabled={chores.length === 0}
                    onClick={() => beginMissions(member.id)}
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
              onClick={() => openNewForm()}
            >
              <Plus />
              {c.add}
            </button>
          </section>
        </main>
      )}
      {screen === 'child' && childMember && (
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
                onClick={() => stepChild(-1)}
                aria-label={c.prevChild}
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                className="planner-icon-button"
                onClick={() => stepChild(1)}
                aria-label={c.nextChild}
              >
                <ChevronRight />
              </button>
            </div>
            <button
              type="button"
              className="planner-col-play planner-col-play--big"
              disabled={columnTasks(childMember.id).length === 0}
              onClick={() => beginMissions(childMember.id)}
              aria-label={`${c.startMissions}: ${childMember.name}`}
            >
              {'\u25B6'}
            </button>
          </header>

          <section className="planner-detail-section">
            <h3>
              {c.goals}
              <span>{rewardsForMember(childMember.id).length}</span>
            </h3>
            {rewardsForMember(childMember.id).length === 0 && (
              <p className="planner-col-empty">{c.noRewards}</p>
            )}
            {rewardsForMember(childMember.id).map((reward) => renderRewardRow(reward))}
            <button
              className="planner-ghost planner-reward-new"
              onClick={() => startRewardForm(childMember.id)}
            >
              <Plus />
              {c.setGoal}
            </button>
          </section>

          <section className="planner-detail-section">
            <h3>
              {c.choresColumn}
              <span>{columnTasks(childMember.id).length}</span>
            </h3>
            {columnTasks(childMember.id).length === 0 ? (
              <p className="planner-col-empty">{c.nothing}</p>
            ) : (
              columnTasks(childMember.id).map((task) => renderRow(task))
            )}
          </section>

          <section className="planner-detail-section">
            <h3>
              {c.done}
              <span>{completedTasksFor(childMember.id).length}</span>
            </h3>
            {completedTasksFor(childMember.id).length === 0 ? (
              <p className="planner-col-empty">{c.nothing}</p>
            ) : (
              completedTasksFor(childMember.id).map((task) => renderRow(task))
            )}
          </section>

          <section className="planner-detail-section">
            <h3>
              {c.routines}
              <span>{columnRoutines(childMember.id).length}</span>
            </h3>
            {columnRoutines(childMember.id).length === 0 ? (
              <p className="planner-col-empty">{c.noRoutines}</p>
            ) : (
              columnRoutines(childMember.id).map((routine) => routineRow(routine))
            )}
          </section>
        </main>
      )}
      {screen === 'missions' && selectedTodayMember && (
        <main className="planner-content planner-missions">
          <p className="planner-eyebrow">03 / 04</p>
          <h2>{c.missions}</h2>
          {data.tasks
            .filter(
              (task) =>
                task.memberId === selectedTodayMember.id &&
                taskStatus(task) !== 'completed' &&
                taskStatus(task) !== 'expired',
            )
            .sort(byDeadline)
            .map((task) => renderTask(task, true))}
          {memberTodayCount(selectedTodayMember.id) === 0 && (
            <p className="planner-empty-copy">{c.nothing}</p>
          )}
          <button
            className="planner-primary"
            disabled={memberTodayCount(selectedTodayMember.id) === 0}
            onClick={() => beginMissions(selectedTodayMember.id)}
          >
            {c.startMissions}
            <ChevronRight />
          </button>
        </main>
      )}
      {screen === 'mission' && missionTask && selectedTodayMember && (
        <main className="planner-mission-screen">
          <div className="planner-mission-progress">
            <span>
              {missionIndex + 1} {t('planner.of')} {missionIds.length}
            </span>
            <div>
              <i style={{ width: `${((missionIndex + 1) / missionIds.length) * 100}%` }} />
            </div>
          </div>
          <div className="planner-mission-hero">
            {missionTask.icon && <span>{missionTask.icon}</span>}
            <h2>{missionTask.name}</h2>
            {missionTask.points > 0 && <b>⭐ {missionTask.points}</b>}
            <p>
              {activeMissionStatus === 'late'
                ? c.late
                : activeMissionStatus === 'retry'
                  ? c.retryCopy
                  : `${c.active} ${countdown(missionTask.deadlineAt, now, c)}`}
            </p>
          </div>
          <button
            className="planner-mission-done"
            disabled={!online || pendingTaskId === missionTask.id}
            onClick={() => void completeTask(missionTask)}
          >
            {c.iDidIt}
            <Check />
          </button>
        </main>
      )}
      {screen === 'closing' && selectedTodayMember && (
        <main className="planner-today-step planner-celebrate">
          {/* Celebration card: soft glow, trophy, "{Well done, name}!" and the
              goal pill — the closing screen of the reference app. */}
          <div className="planner-celebrate-glow" aria-hidden="true">
            <span>{'\u{1F3C6}'}</span>
          </div>
          <h2 className="planner-celebrate-title">
            {t('planner.wellDone', { name: selectedTodayMember.name })}
          </h2>
          <p className="planner-celebrate-pill">
            <span aria-hidden="true">{'\u{1F3AF}'}</span>
            {c.todayEarned}: {completedTodayPoints(selectedTodayMember.id)}
          </p>
          <p className="planner-celebrate-sub">
            {c.pot}: {spendableFor(selectedTodayMember)}
          </p>
          <button
            className="planner-primary"
            onClick={() => {
              setScreen('board');
              setTodayMemberId(null);
            }}
          >
            {c.pass}
          </button>
        </main>
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
            </button>
            {modal === 'form' && (
              <>
                <h2>{editingId ? c.edit : c.add}</h2>
                <label className="planner-field">
                  {c.name}
                  <input
                    autoFocus
                    value={form.name}
                    disabled={Boolean(editingId)}
                    onChange={(event) =>
                      setForm((value) => ({ ...value, name: event.target.value }))
                    }
                  />
                  {editingId && <small className="planner-hint">{c.renameLocked}</small>}
                </label>
                <label className="planner-field">
                  {c.points}
                  <div className="planner-stepper">
                    <button
                      onClick={() =>
                        setForm((value) => ({ ...value, points: Math.max(0, value.points - 1) }))
                      }
                    >
                      −
                    </button>
                    <strong>{form.points}</strong>
                    <button
                      onClick={() =>
                        setForm((value) => ({ ...value, points: Math.min(100, value.points + 1) }))
                      }
                    >
                      +
                    </button>
                  </div>
                </label>
                <fieldset className="planner-field">
                  <legend>{c.forWho}</legend>
                  <div className="planner-member-picker">
                    <button
                      className={
                        form.memberIds.length === data.members.length && !form.free
                          ? 'is-selected'
                          : ''
                      }
                      onClick={() =>
                        setForm((value) => ({
                          ...value,
                          free: false,
                          memberIds:
                            value.memberIds.length === data.members.length
                              ? []
                              : data.members.map((member) => member.id),
                        }))
                      }
                    >
                      {c.everyone}
                    </button>
                    {data.members.map((member) => (
                      <button
                        key={member.id}
                        className={form.memberIds.includes(member.id) ? 'is-selected' : ''}
                        onClick={() =>
                          setForm((value) => ({
                            ...value,
                            free: false,
                            memberIds: value.memberIds.includes(member.id)
                              ? value.memberIds.filter((id) => id !== member.id)
                              : [...value.memberIds, member.id],
                          }))
                        }
                      >
                        <span>
                          <MemberAvatar member={member} />
                        </span>
                        {member.name}
                      </button>
                    ))}
                  </div>
                  <label className="planner-check-label">
                    <input
                      type="checkbox"
                      checked={form.free}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          free: event.target.checked,
                          memberIds: event.target.checked ? [] : value.memberIds,
                        }))
                      }
                    />
                    {c.freeTask}
                  </label>
                </fieldset>
                <>
                  <label className="planner-field">
                    {c.description}
                    <input
                      value={form.liveDescription}
                      onChange={(event) =>
                        setForm((value) => ({ ...value, liveDescription: event.target.value }))
                      }
                    />
                  </label>
                  <label className="planner-field">
                    {c.routineLabel}
                    <input
                      value={form.liveLabel}
                      placeholder={c.routinePlaceholder}
                      onChange={(event) =>
                        setForm((value) => ({ ...value, liveLabel: event.target.value }))
                      }
                    />
                    <small className="planner-hint">{c.routineHint}</small>
                  </label>
                  <label className="planner-field">
                    {c.frequency}
                    <select
                      value={form.liveFrequency}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          liveFrequency: event.target.value as ChoreOpsFrequency,
                        }))
                      }
                    >
                      {CHOREOPS_FREQUENCIES.map((frequency) => (
                        <option key={frequency} value={frequency}>
                          {t(FREQUENCY_KEY[frequency])}
                        </option>
                      ))}
                    </select>
                  </label>
                  {form.liveFrequency === 'weekly' && (
                    <div className="planner-weekdays">
                      {DAY_KEYS.map((day, index) => (
                        <button
                          key={index}
                          className={form.liveWeekdays.includes(index) ? 'is-selected' : ''}
                          onClick={() =>
                            setForm((value) => ({
                              ...value,
                              liveWeekdays: value.liveWeekdays.includes(index)
                                ? value.liveWeekdays.filter((item) => item !== index)
                                : [...value.liveWeekdays, index],
                            }))
                          }
                        >
                          {t(`planner.day.${day}`)}
                        </button>
                      ))}
                    </div>
                  )}
                  {(form.liveFrequency === 'custom' ||
                    form.liveFrequency === 'custom_from_complete') && (
                    <>
                      <label className="planner-field">
                        {c.interval}
                        <input
                          type="number"
                          min="1"
                          max="365"
                          value={form.liveInterval}
                          onChange={(event) =>
                            setForm((value) => ({
                              ...value,
                              liveInterval: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label className="planner-field">
                        {c.every}
                        <select
                          value={form.liveIntervalUnit}
                          onChange={(event) =>
                            setForm((value) => ({
                              ...value,
                              liveIntervalUnit: event.target.value as ChoreOpsIntervalUnit,
                            }))
                          }
                        >
                          {CHOREOPS_INTERVAL_UNITS.map((unit) => (
                            <option key={unit} value={unit}>
                              {t(UNIT_KEY[unit])}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  <label className="planner-field">
                    {c.dueAt}
                    <input
                      type="datetime-local"
                      value={form.deadlineAt}
                      onChange={(event) =>
                        setForm((value) => ({ ...value, deadlineAt: event.target.value }))
                      }
                    />
                  </label>
                  <label className="planner-field">
                    {c.dueWindow}
                    <input
                      value={form.liveWindow}
                      placeholder="1h"
                      onChange={(event) =>
                        setForm((value) => ({ ...value, liveWindow: event.target.value }))
                      }
                    />
                    <small className="planner-hint">{c.dueWindowHint}</small>
                  </label>
                  <label className="planner-field">
                    {c.reminder}
                    <input
                      value={form.liveReminder}
                      placeholder="30m"
                      onChange={(event) =>
                        setForm((value) => ({ ...value, liveReminder: event.target.value }))
                      }
                    />
                    <small className="planner-hint">{c.reminderHint}</small>
                  </label>
                  <label className="planner-check-label">
                    <input
                      type="checkbox"
                      checked={form.liveAutoApprove}
                      onChange={(event) =>
                        setForm((value) => ({ ...value, liveAutoApprove: event.target.checked }))
                      }
                    />
                    {c.autoApprove}
                  </label>
                </>
                <footer className="planner-sheet-footer">
                  <button className="planner-ghost" onClick={() => setModal(null)}>
                    {c.cancel}
                  </button>
                  <button
                    className="planner-primary"
                    disabled={!form.name.trim() || (!form.memberIds.length && !form.free) || saving}
                    onClick={() => void saveForm()}
                  >
                    {saving ? '\u2026' : editingId ? c.save : c.create}
                  </button>
                </footer>
              </>
            )}
            {modal === 'actions' && selectedTask && (
              <>
                <h2>{c.action}</h2>
                {taskStatus(selectedTask) === 'completed' ? null : (
                  <button
                    className="planner-destination"
                    onClick={() => openEditForm(selectedTask)}
                  >
                    <Pencil />
                    <strong>{c.edit}</strong>
                  </button>
                )}
                <button
                  className="planner-destination planner-danger"
                  onClick={() => {
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
                >
                  <Trash2 />
                  <strong>{confirmingDelete ? c.sure : c.remove}</strong>
                </button>
              </>
            )}
            {modal === 'award' && awardTask && (
              <>
                <h2>{c.awardTitle}</h2>
                <p className="planner-hint">
                  {awardTask.name}
                  {awardTask.points > 0 && ` \u00b7 ${'\u{1F3C6}'} ${awardTask.points}`}
                </p>
                <div className="planner-goal-list">
                  <button type="button" className="planner-goal" onClick={() => setModal(null)}>
                    <span className="planner-goal-icon" aria-hidden="true">
                      {'\u{1F3E6}'}
                    </span>
                    <span className="planner-goal-copy">
                      <strong>{c.savingsPot}</strong>
                      <small>
                        {c.pot} \u00b7 {spendableFor(memberFor(awardTask.memberId))}
                      </small>
                    </span>
                  </button>
                  {rewardsForMember(awardTask.memberId).map((reward) => {
                    const { saved, affordable } = rewardState(reward);
                    return (
                      <button
                        type="button"
                        className="planner-goal"
                        key={reward.id}
                        disabled={!affordable}
                        onClick={() => {
                          assignReward(reward);
                          setModal(null);
                        }}
                      >
                        <span className="planner-goal-icon" aria-hidden="true">
                          {'\u{1F381}'}
                        </span>
                        <span className="planner-goal-copy">
                          <strong>{reward.name}</strong>
                          <small>
                            {affordable
                              ? c.assign
                              : t('planner.stillNeeded', {
                                  points: String(Math.max(0, reward.cost - saved)),
                                })}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="planner-goal planner-goal--new"
                    onClick={() => {
                      if (awardTask.memberId) startRewardForm(awardTask.memberId);
                      else setModal('reward-form');
                    }}
                  >
                    <span className="planner-goal-icon" aria-hidden="true">
                      +
                    </span>
                    <span className="planner-goal-copy">
                      <strong>{c.setGoal}</strong>
                    </span>
                  </button>
                </div>
              </>
            )}
            {modal === 'filter' && (
              <>
                <h2>{c.filterTitle}</h2>
                <div className="planner-member-picker">
                  {data.members.map((member) => {
                    const hidden = hiddenMemberIds.includes(member.id);
                    return (
                      <button
                        type="button"
                        key={member.id}
                        className={hidden ? '' : 'is-selected'}
                        aria-pressed={!hidden}
                        onClick={() =>
                          setHiddenMemberIds((ids) =>
                            ids.includes(member.id)
                              ? ids.filter((id) => id !== member.id)
                              : [...ids, member.id],
                          )
                        }
                      >
                        <MemberAvatar member={member} />
                        {member.name}
                      </button>
                    );
                  })}
                </div>
                {data.routines.length > 0 && (
                  <>
                    <h2>{c.pausedRoutines}</h2>
                    <div className="planner-goal-list">
                      {data.routines.map((routine) => {
                        const paused = pausedRoutineIds.includes(routine.id);
                        return (
                          <button
                            type="button"
                            className="planner-goal"
                            key={routine.id}
                            onClick={() => toggleRoutinePaused(routine.id)}
                          >
                            <span className="planner-goal-icon" aria-hidden="true">
                              {routine.icon}
                            </span>
                            <span className="planner-goal-copy">
                              <strong>{routine.fallback ? c.otherDaily : routine.name}</strong>
                              <small>{paused ? c.paused : c.active}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                <footer className="planner-sheet-footer">
                  <button className="planner-ghost" onClick={() => setModal(null)}>
                    {c.cancel}
                  </button>
                </footer>
              </>
            )}
            {modal === 'claim' && claimTask && (
              <>
                <h2>{claimTask.name}</h2>
                <p className="planner-hint">{c.claimWho}</p>
                <div className="planner-member-picker planner-member-picker--claim">
                  {claimOptionsFor(claimTask).map((option) => {
                    const member = memberFor(option.memberId);
                    if (!member) return null;
                    return (
                      <button
                        key={option.memberId}
                        type="button"
                        onClick={() => {
                          setModal(null);
                          void runLiveAction(
                            option.id,
                            option.actions!.claim!,
                            option.name,
                            c.claimedToast,
                          );
                        }}
                      >
                        <MemberAvatar member={member} />
                        {member.name}
                      </button>
                    );
                  })}
                </div>
                <footer className="planner-sheet-footer">
                  <button className="planner-ghost" onClick={() => setModal(null)}>
                    {c.cancel}
                  </button>
                </footer>
              </>
            )}
            {modal === 'goals' && goalsMember && (
              <>
                <h2>
                  {c.goals}
                  {' \u00b7 '}
                  {goalsMember.name}
                </h2>
                {rewardsForMember(goalsMember.id).length === 0 && <p>{c.noRewards}</p>}
                {rewardsForMember(goalsMember.id).map((reward) => renderRewardRow(reward))}
                <button
                  className="planner-ghost planner-reward-new"
                  onClick={() => startRewardForm(goalsMember.id)}
                >
                  <Plus />
                  {c.setGoal}
                </button>
              </>
            )}
            {modal === 'reward-actions' && selectedReward && (
              <>
                <h2>{c.action}</h2>
                <button
                  className="planner-destination"
                  onClick={() => {
                    setEditingReward(selectedReward.name);
                    setRewardForm({
                      name: selectedReward.name,
                      cost: Math.round(selectedReward.cost),
                      memberIds: [],
                    });
                    setModal('reward-form');
                  }}
                >
                  <Pencil />
                  <strong>{c.cost}</strong>
                </button>
                <button
                  className="planner-destination planner-danger"
                  onClick={() => void removeReward(selectedReward)}
                >
                  <Trash2 />
                  <strong>{c.remove}</strong>
                </button>
              </>
            )}
            {modal === 'reward-form' && (
              <>
                <h2>{editingReward ? c.cost : c.newReward}</h2>
                <label className="planner-field">
                  {c.name}
                  <input
                    autoFocus
                    value={rewardForm.name}
                    disabled={Boolean(editingReward)}
                    onChange={(event) =>
                      setRewardForm((value) => ({ ...value, name: event.target.value }))
                    }
                  />
                  {editingReward && <small className="planner-hint">{c.renameLocked}</small>}
                </label>
                <label className="planner-field">
                  {c.cost}
                  <input
                    type="number"
                    min="1"
                    max="9999"
                    value={rewardForm.cost}
                    onChange={(event) =>
                      setRewardForm((value) => ({ ...value, cost: Number(event.target.value) }))
                    }
                  />
                </label>
                {!editingReward && (
                  <fieldset className="planner-field">
                    <legend>{c.forWho}</legend>
                    <div className="planner-member-picker">
                      {data.members.map((member) => (
                        <button
                          key={member.id}
                          className={rewardForm.memberIds.includes(member.id) ? 'is-selected' : ''}
                          onClick={() =>
                            setRewardForm((value) => ({
                              ...value,
                              memberIds: value.memberIds.includes(member.id)
                                ? value.memberIds.filter((id) => id !== member.id)
                                : [...value.memberIds, member.id],
                            }))
                          }
                        >
                          <MemberAvatar member={member} />
                          {member.name}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
                <footer className="planner-sheet-footer">
                  <button className="planner-ghost" onClick={() => setModal(null)}>
                    {c.cancel}
                  </button>
                  <button
                    className="planner-primary"
                    disabled={
                      saving ||
                      rewardForm.cost < 1 ||
                      (!editingReward &&
                        (!rewardForm.name.trim() || rewardForm.memberIds.length === 0))
                    }
                    onClick={() => void saveReward()}
                  >
                    {saving ? '\u2026' : c.save}
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
      {confirmAction && (
        <div className="planner-backdrop" onClick={() => setConfirmAction(null)}>
          <section
            className="planner-sheet planner-sheet--confirm"
            role="dialog"
            aria-modal="true"
            aria-label={confirmAction.kind === 'claim' ? c.confirmClaimTitle : c.confirmDoneTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{confirmAction.kind === 'claim' ? c.confirmClaimTitle : c.confirmDoneTitle}</h2>
            <p>{confirmAction.kind === 'claim' ? c.confirmClaimBody : c.confirmDoneBody}</p>
            <p className="planner-confirm-target">{confirmAction.label}</p>
            <footer className="planner-sheet-footer">
              <button className="planner-ghost" onClick={() => setConfirmAction(null)}>
                {c.cancel}
              </button>
              <button
                className="planner-primary"
                disabled={pendingTaskId === confirmAction.taskId}
                onClick={() => {
                  const action = confirmAction;
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
              >
                {c.confirm}
              </button>
            </footer>
          </section>
        </div>
      )}
      {pinGate && (
        <div className="planner-backdrop" onClick={() => setPinGate(null)}>
          <section
            className="planner-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={c.pinTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{c.pinTitle}</h2>
            <p>
              {pinGate.title} · {pinGate.description}
            </p>
            <p>{c.pinHint}</p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={6}
              aria-label={c.pinTitle}
              className="planner-pin-input"
              value={livePin}
              onChange={(event) => {
                setLivePin(normalizePin(event.target.value));
                setLivePinError(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitPin();
                if (event.key === 'Escape') setPinGate(null);
              }}
            />
            {livePinError && (
              <p className="planner-validation" role="alert">
                {c.pinWrong}
              </p>
            )}
            <footer className="planner-sheet-footer">
              <button className="planner-ghost" onClick={() => setPinGate(null)}>
                {c.cancel}
              </button>
              <button className="planner-primary" onClick={submitPin}>
                {c.pinConfirm}
              </button>
            </footer>
          </section>
        </div>
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
