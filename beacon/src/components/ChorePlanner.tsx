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
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ChorePlannerState, PlannerTask, getPlannerTaskStatus } from '../api/chore-planner-model';
import type { PlannerMember } from '../api/chore-planner-model';
import { buildChorePlannerView } from '../api/chore-planner-view';
import {
  resolveMemberForUser,
  formatChoreOpsOffset,
  CHOREOPS_ALL_USERS,
  CHOREOPS_FREQUENCIES,
  CHOREOPS_INTERVAL_UNITS,
} from '../api/choreops';
import type { ChoreOpsFrequency, ChoreOpsIntervalUnit } from '../api/choreops';
import {
  readRewardReservations,
  releasePoints,
  reservationFor,
  reservePoints,
  spendablePoints,
  writeRewardReservations,
} from '../api/reward-reservations';
import type { RewardReservation } from '../api/reward-reservations';
import type { ChoreOpsChore, ChoreOpsReward } from '../types/choreops';
import { useChoreOps } from '../hooks/useChoreOps';
import { useTranslation, type TranslationKey } from '../i18n';
import { LOCALE_OPTIONS } from '../i18n/locales';
import { normalizePin, type FamilyMember } from '../types/family';
import { MemberAvatar } from './MemberAvatar';
import type { CalendarEvent } from '../types';

type Screen = 'lobby' | 'overview' | 'missions' | 'mission' | 'closing';

/** Tabs on a child's own page, mirroring the family-planner app. */
type ChildTab = 'goals' | 'chores' | 'routines' | 'free';

const CHILD_TAB_ICON: Record<ChildTab, string> = {
  goals: '\u{1F381}',
  chores: '\u{1F4CB}',
  routines: '\u{1F501}',
  free: '\u{1F450}',
};

const CHILD_TAB_LABEL: Record<ChildTab, TranslationKey> = {
  goals: 'planner.tab.goals',
  chores: 'planner.tab.chores',
  routines: 'planner.tab.routines',
  free: 'planner.tab.free',
};

/** Outcome shown in the bottom-right notification. */
type ToastKind = 'success' | 'error';

/** Parent PINs must be at least this long to unlock approvals. */
const MIN_PIN_LENGTH = 4;

/** Planner weekday indexes (Monday first) → ChoreOps day keys. */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** ChoreOps repeat options → dictionary keys, so the picker follows the app language. */
const FREQUENCY_KEY: Record<ChoreOpsFrequency, TranslationKey> = {
  none: 'planner.freq.none',
  daily: 'planner.freq.daily',
  daily_multi: 'planner.freq.daily_multi',
  weekly: 'planner.freq.weekly',
  biweekly: 'planner.freq.biweekly',
  monthly: 'planner.freq.monthly',
  quarterly: 'planner.freq.quarterly',
  yearly: 'planner.freq.yearly',
  custom: 'planner.freq.custom',
  custom_from_complete: 'planner.freq.custom_from_complete',
  week_end: 'planner.freq.week_end',
  month_end: 'planner.freq.month_end',
  quarter_end: 'planner.freq.quarter_end',
  year_end: 'planner.freq.year_end',
};

/** Interval unit labels for `custom` repeats. */
const UNIT_KEY: Record<ChoreOpsIntervalUnit, TranslationKey> = {
  hours: 'planner.unit.hours',
  days: 'planner.unit.days',
  weeks: 'planner.unit.weeks',
  months: 'planner.unit.months',
};

/** "Aangemaakt · Afwassen": the action first, then the chore it happened to. */
function toastWith(action: string, label: string): string {
  return `${action} · ${label}`;
}
type FormValue = {
  name: string;
  icon: string;
  points: number;
  memberIds: string[];
  free: boolean;
  kind: 'task' | 'routine';
  monthlyDay: number;
  startsAt: string;
  deadlineAt: string;
  retry: boolean;
  grace: number;
  timeBlock: 'morning' | 'afternoon' | 'evening' | 'custom';
  customStart: string;
  customEnd: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'interval';
  interval: number;
  weekdays: number[];
  /** ChoreOps schedule — only read and written in live mode. */
  liveFrequency: ChoreOpsFrequency;
  liveInterval: number;
  liveIntervalUnit: ChoreOpsIntervalUnit;
  liveWeekdays: number[];
  /** Due window offset, e.g. `1h`; empty means "no window". */
  liveWindow: string;
  /** Reminder offset; empty means "leave the current reminder alone". */
  liveReminder: string;
  liveAutoApprove: boolean;
  liveDescription: string;
  /** First ChoreOps label: names the daily routine this chore belongs to. */
  liveLabel: string;
};

interface ChorePlannerProps {
  nextAppointment: CalendarEvent | null;
  /** Beacon family members supply photos, colours, and display names. */
  members: FamilyMember[];
  /** App language (`BeaconSettings.locale`); the planner has no own language switch. */
  locale: string;
  /** The same updater Settings uses, so picking a language here changes the whole app. */
  onLocaleChange: (locale: string) => void;
}

/**
 * Planner copy comes from the shared i18n dictionary (`planner.*`), so the
 * chores screen speaks whatever language is selected in Beacon's settings.
 * There is no private EN/NL switch to keep in sync any more.
 */
function usePlannerCopy() {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      title: t('planner.title'),
      shortTitle: t('planner.shortTitle'),
      everyone: t('planner.everyone'),
      open: t('planner.open'),
      late: t('planner.late'),
      done: t('planner.done'),
      created: t('planner.created'),
      claimedToast: t('planner.claimedToast'),
      approved: t('planner.approved'),
      removedToast: t('planner.removedToast'),
      assignedToast: t('planner.assignedToast'),
      undoneToast: t('planner.undoneToast'),
      today: t('planner.today'),
      weather: t('planner.weather'),
      nextAppointment: t('planner.nextAppointment'),
      noAppointment: t('planner.noAppointment'),
      free: t('planner.free'),
      nothing: t('planner.nothing'),
      add: t('planner.add'),
      anyone: t('planner.anyone'),
      edit: t('planner.edit'),
      remove: t('planner.remove'),
      cancel: t('planner.cancel'),
      save: t('planner.save'),
      savedToast: t('planner.savedToast'),
      task: t('planner.task'),
      name: t('planner.name'),
      points: t('planner.points'),
      pointsUnit: t('planner.pointsUnit'),
      forWho: t('planner.forWho'),
      freeTask: t('planner.freeTask'),
      frequency: t('planner.frequency'),
      daily: t('planner.daily'),
      weekly: t('planner.weekly'),
      monthly: t('planner.monthly'),
      interval: t('planner.interval'),
      every: t('planner.every'),
      morning: t('planner.morning'),
      afternoon: t('planner.afternoon'),
      evening: t('planner.evening'),
      due: t('planner.due'),
      claim: t('planner.claim'),
      confirm: t('planner.confirm'),
      confirmClaimTitle: t('planner.confirmClaimTitle'),
      confirmClaimBody: t('planner.confirmClaimBody'),
      confirmDoneTitle: t('planner.confirmDoneTitle'),
      confirmDoneBody: t('planner.confirmDoneBody'),
      expired: t('planner.expired'),
      upcoming: t('planner.upcoming'),
      active: t('planner.active'),
      retryCopy: t('planner.retryCopy'),
      completedAt: t('planner.completedAt'),
      noFail: t('planner.noFail'),
      pot: t('planner.pot'),
      back: t('planner.back'),
      startMissions: t('planner.startMissions'),
      chooseWhat: t('planner.chooseWhat'),
      assignPoints: t('planner.assignPoints'),
      assignPointsHint: t('planner.assignPointsHint'),
      missionsHint: t('planner.missionsHint'),
      missions: t('planner.missions'),
      continue: t('planner.continue'),
      iDidIt: t('planner.iDidIt'),
      pass: t('planner.pass'),
      todayEarned: t('planner.todayEarned'),
      noMissions: t('planner.noMissions'),
      action: t('planner.action'),
      privacy: t('planner.privacy'),
      sound: t('planner.sound'),
      routines: t('planner.routines'),
      routineLabel: t('planner.routineLabel'),
      routinePlaceholder: t('planner.routinePlaceholder'),
      routineHint: t('planner.routineHint'),
      otherDaily: t('planner.otherDaily'),
      noRoutines: t('planner.noRoutines'),
      setGoal: t('planner.setGoal'),
      prevChild: t('planner.prevChild'),
      nextChild: t('planner.nextChild'),
      offline: t('planner.offline'),
      assignToClaim: t('planner.assignToClaim'),
      pinTitle: t('planner.pinTitle'),
      pinHint: t('planner.pinHint'),
      pinWrong: t('planner.pinWrong'),
      pinConfirm: t('planner.pinConfirm'),
      create: t('planner.create'),
      sure: t('planner.sure'),
      score: t('planner.score'),
      description: t('planner.description'),
      dueAt: t('planner.dueAt'),
      dueWindow: t('planner.dueWindow'),
      dueWindowHint: t('planner.dueWindowHint'),
      reminder: t('planner.reminder'),
      reminderHint: t('planner.reminderHint'),
      autoApprove: t('planner.autoApprove'),
      renameLocked: t('planner.renameLocked'),
      rewards: t('planner.rewards'),
      noRewards: t('planner.noRewards'),
      newReward: t('planner.newReward'),
      cost: t('planner.cost'),
      assign: t('planner.assign'),
      assigned: t('planner.assigned'),
      undoShort: t('planner.undoShort'),
      locked: t('planner.locked'),
      claimed: t('planner.claimed'),
      openTodo: t('planner.openTodo'),
      hoursShort: t('planner.hoursShort'),
      minutesShort: t('planner.minutesShort'),
    }),
    [t],
  );
}
type PlannerCopy = ReturnType<typeof usePlannerCopy>;
function localDateTime(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** `10:30` in the app's locale — every clock time on the board goes through this. */
function clockTime(value: Date | string, intl: string): string {
  return new Date(value).toLocaleTimeString(intl, { hour: '2-digit', minute: '2-digit' });
}

function countdown(
  target: string | null,
  now: Date,
  copy: Pick<PlannerCopy, 'hoursShort' | 'minutesShort'>,
): string {
  if (!target) return '';
  const minutes = Math.max(0, Math.ceil((new Date(target).getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours ? `${hours}${copy.hoursShort} ` : ''}${rest}${copy.minutesShort}`;
}

function formFromTask(task: PlannerTask): FormValue {
  return {
    name: task.name,
    icon: task.icon ?? '',
    points: task.points,
    memberIds: task.memberId ? [task.memberId] : [],
    free: !task.memberId,
    kind: task.kind,
    monthlyDay: new Date(task.startsAt).getDate(),
    startsAt: localDateTime(new Date(task.startsAt)),
    deadlineAt: localDateTime(
      new Date(task.deadlineAt ?? task.expiresAt ?? Date.now() + 3_600_000),
    ),
    retry: Boolean(task.retryMinutes),
    grace: task.retryMinutes ?? 60,
    timeBlock: task.timeBlock,
    customStart: task.customStart ?? '07:00',
    customEnd: task.customEnd ?? '11:59',
    frequency: 'daily',
    interval: 2,
    weekdays: [1, 2, 3, 4, 5],
    liveFrequency: 'none',
    liveInterval: 1,
    liveIntervalUnit: 'days',
    liveWeekdays: [0, 1, 2, 3, 4],
    liveWindow: '',
    liveReminder: '',
    liveAutoApprove: false,
    liveDescription: '',
    liveLabel: '',
  };
}

/** Prefill the edit form from the chore ChoreOps publishes. */
function formFromLiveTask(task: PlannerTask, chore: ChoreOpsChore | null): FormValue {
  const base = formFromTask(task);
  const days = chore?.applicableDays ?? [];
  return {
    ...base,
    points: chore?.points ?? base.points,
    liveFrequency: (chore?.frequency as ChoreOpsFrequency | null) ?? 'none',
    liveWeekdays: days
      .map((day) => DAY_KEYS.indexOf(day as (typeof DAY_KEYS)[number]))
      .filter((index) => index >= 0),
    liveWindow: formatChoreOpsOffset(chore?.windowOffset),
    liveAutoApprove: chore?.autoApprove ?? false,
    liveDescription: chore?.description ?? '',
    liveLabel: chore?.labels?.[0] ?? '',
    deadlineAt: chore?.dueDate ? localDateTime(new Date(chore.dueDate)) : base.deadlineAt,
  };
}

function emptyForm(now: Date): FormValue {
  return {
    name: '',
    icon: '✅',
    points: 5,
    memberIds: [],
    free: false,
    kind: 'task',
    monthlyDay: now.getDate(),
    startsAt: localDateTime(now),
    deadlineAt: localDateTime(new Date(now.getTime() + 3_600_000)),
    retry: false,
    grace: 60,
    timeBlock: 'morning',
    customStart: '07:00',
    customEnd: '11:59',
    frequency: 'daily',
    interval: 2,
    weekdays: [1, 2, 3, 4, 5],
    liveFrequency: 'none',
    liveInterval: 1,
    liveIntervalUnit: 'days',
    liveWeekdays: [0, 1, 2, 3, 4],
    liveWindow: '',
    liveReminder: '',
    liveAutoApprove: false,
    liveDescription: '',
    liveLabel: '',
  };
}

export function ChorePlanner({
  nextAppointment,
  members,
  locale,
  onLocaleChange,
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
  const [screen, setScreen] = useState<Screen>('lobby');
  const [modal, setModal] = useState<
    'form' | 'actions' | 'rewards' | 'reward-form' | 'reward-actions' | null
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
  /** Which tab of the child's page is open (goals / chores / routines / free). */
  const [childTab, setChildTab] = useState<ChildTab>('chores');
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

  /** Calendar order for a list of chores. */
  const byDeadline = (a: PlannerTask, b: PlannerTask) =>
    new Date(a.deadlineAt ?? a.expiresAt ?? a.startsAt).getTime() -
    new Date(b.deadlineAt ?? b.expiresAt ?? b.startsAt).getTime();

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

  const openNewForm = () => {
    setEditingId(null);
    setForm(emptyForm(now));
    setModal('form');
  };

  /** Move to the previous/next child on their page (wraps around). */
  const switchChild = (delta: number) => {
    if (!data.members.length) return;
    const index = data.members.findIndex((member) => member.id === todayMemberId);
    const next = data.members[(index + delta + data.members.length) % data.members.length];
    if (next) setTodayMemberId(next.id);
  };

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
          setModal('rewards');
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
        setModal('rewards');
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
        setModal('rewards');
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

  const beginMissions = () => {
    if (!todayMemberId) return;
    const queue = data.tasks
      .filter(
        (task) =>
          task.memberId === todayMemberId && !['completed', 'expired'].includes(taskStatus(task)),
      )
      .sort(byDeadline)
      .map((task) => task.id);
    setMissionIds(queue);
    setMissionIndex(0);
    setScreen(queue.length ? 'mission' : 'closing');
  };

  const section = (title: string, tasks: PlannerTask[], tone = '') =>
    tasks.length > 0 && (
      <section className={`planner-section ${tone}`} key={title}>
        <h2>
          {title}
          <span>{tasks.length}</span>
        </h2>
        <div className="planner-task-list">
          {tasks.sort(byDeadline).map((task) => renderTask(task))}
        </div>
      </section>
    );

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
    screen === 'lobby'
      ? c.today
      : screen === 'missions' || screen === 'mission'
        ? c.missions
        : screen === 'closing'
          ? c.todayEarned
          : (selectedTodayMember?.name ?? c.title);

  return (
    <div className={`chore-planner ${privacy ? 'chore-planner--private' : ''}`}>
      <header className="planner-header">
        {(screen === 'overview' || screen === 'missions') && (
          <button
            className="planner-icon-button"
            onClick={() => setScreen('lobby')}
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
          {/* Qudoo-style hero: a small line with the date above the page title. */}
          <span className="planner-eyebrow">
            {now.toLocaleDateString(timeLocale, { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          {screen === 'overview' && selectedTodayMember ? (
            /* Three joined segments: an arrow, the child's name set exactly like
               any other page title, and the arrow back. Only the two outside
               edges are rounded, so the bar reads as one control. */
            <div className="planner-child-switch">
              <button
                type="button"
                className="planner-child-switch-arrow"
                onClick={() => switchChild(-1)}
                aria-label={c.prevChild}
              >
                <ChevronLeft />
              </button>
              <h1 className="planner-child-switch-name">{selectedTodayMember.name}</h1>
              <button
                type="button"
                className="planner-child-switch-arrow"
                onClick={() => switchChild(1)}
                aria-label={c.nextChild}
              >
                <ChevronRight />
              </button>
            </div>
          ) : (
            <h1>
              {/* Phones get the short name so the header can stay on one row. */}
              <span className="planner-title-full">{heading}</span>
              <span className="planner-title-short">{heading}</span>
            </h1>
          )}
        </div>
        <div className="planner-header-actions">
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
          <button
            className="planner-icon-button"
            onClick={() => setModal('rewards')}
            aria-label={c.rewards}
          >
            <Sparkles />
          </button>
        </div>
      </header>

      {!online && (
        <div className="planner-offline-banner" role="alert">
          {c.offline}
        </div>
      )}

      {screen === 'lobby' && (
        <main className="planner-today-lobby">
          {data.members.map((member) => (
            <button
              key={member.id}
              className="planner-lobby-member"
              style={{ '--member-color': member.color } as React.CSSProperties}
              onClick={() => {
                setTodayMemberId(member.id);
                setScreen('overview');
              }}
            >
              <span className="planner-lobby-avatar">
                <MemberAvatar member={member} />
              </span>
              <strong>{member.name}</strong>
              <span>
                {memberTodayCount(member.id)} {c.score}
              </span>
              <small>{nextAppointment?.title ?? c.noAppointment}</small>
            </button>
          ))}
        </main>
      )}
      {screen === 'overview' && selectedTodayMember && (
        <main className="planner-child">
          <div className="planner-tabs-row">
            <nav className="planner-tabs" aria-label={c.title}>
              {(['goals', 'chores', 'routines', 'free'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`planner-tab ${childTab === tab ? 'is-active' : ''}`}
                  onClick={() => setChildTab(tab)}
                >
                  <span aria-hidden="true">{CHILD_TAB_ICON[tab]}</span>
                  {t(CHILD_TAB_LABEL[tab])}
                </button>
              ))}
            </nav>
            <button
              type="button"
              className="planner-child-add"
              onClick={openNewForm}
              aria-label={c.add}
            >
              <Plus />
            </button>
          </div>

          <div className="planner-child-body">
            {childTab === 'goals' && (
              <section className="planner-child-rewards">
                <div className="planner-child-summary">
                  <span className="planner-child-avatar">
                    <MemberAvatar member={selectedTodayMember} />
                  </span>
                  <strong>{selectedTodayMember.name}</strong>
                  <span className="planner-child-points">
                    {'\u2B50'} {spendableFor(selectedTodayMember)}
                  </span>
                </div>
                {rewardsForMember(selectedTodayMember.id).length === 0 && (
                  <p className="planner-empty-copy">{c.noRewards}</p>
                )}
                {rewardsForMember(selectedTodayMember.id).map((reward) => {
                  const { reserved, saved, available, pending, affordable } = rewardState(reward);
                  const approveId = reward.actions.approve;
                  return (
                    <div className="planner-reward" key={reward.id}>
                      <span aria-hidden="true">{'\u{1F381}'}</span>
                      <div className="planner-reward-copy">
                        <strong>{reward.name}</strong>
                        <small>
                          {reserved
                            ? c.assigned
                            : `${saved} / ${reward.cost} ${c.pointsUnit}${
                                pending ? ` · ${c.claimed}` : available ? '' : ` · ${c.locked}`
                              }`}
                        </small>
                        <i>
                          <b
                            style={{
                              width: `${
                                reserved
                                  ? 100
                                  : Math.min(100, (saved / Math.max(1, reward.cost)) * 100)
                              }%`,
                            }}
                          />
                        </i>
                      </div>
                      <div className="planner-reward-actions">
                        {reserved ? (
                          <>
                            <button
                              className="planner-ghost planner-reward-action"
                              onClick={() => undoRewardChoice(reward)}
                            >
                              {c.undoShort}
                            </button>
                            <button
                              className="planner-primary planner-reward-action"
                              disabled={saving}
                              onClick={() => confirmReward(reward)}
                            >
                              {c.confirm}
                            </button>
                          </>
                        ) : pending && approveId ? (
                          <button
                            className="planner-primary planner-reward-action"
                            onClick={() =>
                              requestPin(
                                c.rewards,
                                reward.name,
                                () =>
                                  void runLiveAction(reward.id, approveId, reward.name, c.approved),
                              )
                            }
                          >
                            {c.confirm}
                          </button>
                        ) : (
                          <button
                            className="planner-ghost planner-reward-action"
                            disabled={!available || !affordable}
                            onClick={() => assignReward(reward)}
                          >
                            {c.assign}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <button
                  className="planner-ghost planner-reward-new"
                  onClick={() => startRewardForm(selectedTodayMember.id)}
                >
                  <Plus />
                  {c.setGoal}
                </button>
              </section>
            )}

            {childTab === 'chores' && (
              <>
                {section(
                  c.open,
                  data.tasks.filter(
                    (task) =>
                      task.memberId === selectedTodayMember.id &&
                      ['active', 'upcoming'].includes(taskStatus(task)),
                  ),
                )}
                {section(
                  c.late,
                  data.tasks.filter(
                    (task) =>
                      task.memberId === selectedTodayMember.id &&
                      ['late', 'retry'].includes(taskStatus(task)),
                  ),
                  'planner-section--late',
                )}
                {section(
                  c.done,
                  data.tasks.filter(
                    (task) =>
                      task.memberId === selectedTodayMember.id && taskStatus(task) === 'completed',
                  ),
                )}
                {memberTodayCount(selectedTodayMember.id) === 0 && (
                  <p className="planner-empty-copy">{c.noMissions}</p>
                )}
              </>
            )}

            {childTab === 'routines' && (
              <>
                {data.routines.filter((routine) =>
                  routine.memberIds.includes(selectedTodayMember.id),
                ).length === 0 && <p className="planner-empty-copy">{c.noRoutines}</p>}
                {data.routines
                  .filter((routine) => routine.memberIds.includes(selectedTodayMember.id))
                  .map((routine) => (
                    <div key={routine.id} className="planner-routine-row">
                      <span>{routine.icon}</span>
                      <strong>{routine.fallback ? c.otherDaily : routine.name}</strong>
                      <small>{routine.frequency === 'daily' ? c.daily : routine.frequency}</small>
                      <span className="planner-routine-time">
                        {routine.timeBlock === 'morning'
                          ? c.morning
                          : routine.timeBlock === 'evening'
                            ? c.evening
                            : c.afternoon}
                      </span>
                    </div>
                  ))}
                {/* The guided run through today's chores lives with the
                    routines: both walk the child through the same list. */}
                <button
                  className="planner-primary planner-start-missions"
                  disabled={memberTodayCount(selectedTodayMember.id) === 0}
                  onClick={beginMissions}
                >
                  {c.startMissions}
                  <ChevronRight />
                </button>
              </>
            )}

            {childTab === 'free' && (
              <>
                {section(
                  c.free,
                  /* Only "anyone can take it" chores — a chore for the whole
                     household is already on every child's list. */
                  data.tasks.filter(
                    (task) =>
                      !task.memberId &&
                      task.audience === 'anyone' &&
                      taskStatus(task) !== 'completed',
                  ),
                )}
                {data.tasks.filter(
                  (task) =>
                    !task.memberId &&
                    task.audience === 'anyone' &&
                    taskStatus(task) !== 'completed',
                ).length === 0 && <p className="planner-empty-copy">{c.nothing}</p>}
              </>
            )}
          </div>
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
            <p className="planner-empty-copy">{c.noMissions}</p>
          )}
          <button
            className="planner-primary"
            disabled={memberTodayCount(selectedTodayMember.id) === 0}
            onClick={beginMissions}
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
              setScreen('lobby');
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
            {modal === 'rewards' && (
              <>
                <h2>{c.rewards}</h2>
                {rewards.length === 0 && <p>{c.noRewards}</p>}
                {rewards
                  .slice()
                  .sort(
                    (a, b) =>
                      (a.pendingClaims > 0 ? 0 : a.status === 'available' ? 1 : 2) -
                      (b.pendingClaims > 0 ? 0 : b.status === 'available' ? 1 : 2),
                  )
                  .map((reward) => {
                    const { reserved, saved, available, pending, affordable } = rewardState(reward);
                    const approveId = reward.actions.approve;
                    return (
                      <div className="planner-reward" key={reward.id}>
                        <span aria-hidden="true">{'\u{1F381}'}</span>
                        <div className="planner-reward-copy">
                          <strong>{reward.name}</strong>
                          <small>
                            {reward.assignee ? `${reward.assignee} · ` : ''}
                            {reserved
                              ? c.assigned
                              : `${saved} / ${reward.cost} ${c.pointsUnit}${
                                  pending ? ` · ${c.claimed}` : available ? '' : ` · ${c.locked}`
                                }`}
                          </small>
                          <i>
                            <b
                              style={{
                                width: `${
                                  reserved
                                    ? 100
                                    : Math.min(100, (saved / Math.max(1, reward.cost)) * 100)
                                }%`,
                              }}
                            />
                          </i>
                        </div>
                        <div className="planner-reward-actions">
                          {reserved ? (
                            <>
                              <button
                                className="planner-ghost planner-reward-action"
                                onClick={() => undoRewardChoice(reward)}
                              >
                                {c.undoShort}
                              </button>
                              <button
                                className="planner-primary planner-reward-action"
                                disabled={saving}
                                onClick={() => confirmReward(reward)}
                              >
                                {c.confirm}
                              </button>
                            </>
                          ) : pending && approveId ? (
                            <button
                              className="planner-primary planner-reward-action"
                              onClick={() =>
                                requestPin(
                                  c.rewards,
                                  reward.name,
                                  () =>
                                    void runLiveAction(
                                      reward.id,
                                      approveId,
                                      reward.name,
                                      c.approved,
                                    ),
                                )
                              }
                            >
                              {c.confirm}
                            </button>
                          ) : (
                            <button
                              className="planner-ghost planner-reward-action"
                              disabled={!available || !affordable}
                              onClick={() => assignReward(reward)}
                            >
                              {c.assign}
                            </button>
                          )}
                          <button
                            type="button"
                            className="planner-task-more"
                            aria-label={`${c.action}: ${reward.name}`}
                            onClick={() => {
                              setSelectedReward(reward);
                              setModal('reward-actions');
                            }}
                          >
                            {'\u22ef'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                <button
                  className="planner-ghost planner-reward-new"
                  onClick={() => {
                    setEditingReward(null);
                    setRewardForm({ name: '', cost: 10, memberIds: [] });
                    setModal('reward-form');
                  }}
                >
                  <Plus />
                  {c.newReward}
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
                  <button className="planner-ghost" onClick={() => setModal('rewards')}>
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
