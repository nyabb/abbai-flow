import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
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
import { normalizePin, type FamilyMember } from '../types/family';
import { MemberAvatar } from './MemberAvatar';
import type { CalendarEvent, WeatherData } from '../types';

type Language = 'nl' | 'en';
type Screen = 'tasks' | 'lobby' | 'welcome' | 'overview' | 'missions' | 'mission' | 'closing';

/** Parent PINs must be at least this long to unlock approvals. */
const MIN_PIN_LENGTH = 4;

/** Planner weekday indexes (Monday first) → ChoreOps day keys. */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Repeat labels for the ChoreOps schedule picker. */
const FREQUENCY_LABEL: Record<Language, Record<string, string>> = {
  nl: {
    none: 'Eenmalig',
    daily: 'Dagelijks',
    daily_multi: 'Meerdere keren per dag',
    weekly: 'Wekelijks',
    biweekly: 'Tweewekelijks',
    monthly: 'Maandelijks',
    quarterly: 'Per kwartaal',
    yearly: 'Jaarlijks',
    custom: 'Aangepast interval',
    custom_from_complete: 'Interval vanaf afronden',
    week_end: 'Einde van de week',
    month_end: 'Einde van de maand',
    quarter_end: 'Einde van het kwartaal',
    year_end: 'Einde van het jaar',
  },
  en: {
    none: 'One-off',
    daily: 'Daily',
    daily_multi: 'Several times a day',
    weekly: 'Weekly',
    biweekly: 'Fortnightly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    yearly: 'Yearly',
    custom: 'Custom interval',
    custom_from_complete: 'Interval after completion',
    week_end: 'End of the week',
    month_end: 'End of the month',
    quarter_end: 'End of the quarter',
    year_end: 'End of the year',
  },
};

/** Interval unit labels for `custom` repeats. */
const UNIT_LABEL: Record<Language, Record<ChoreOpsIntervalUnit, string>> = {
  nl: { hours: 'uur', days: 'dagen', weeks: 'weken', months: 'maanden' },
  en: { hours: 'hours', days: 'days', weeks: 'weeks', months: 'months' },
};

function liveToast(copy: { done: string }, label: string): string {
  return `${copy.done} · ${label}`;
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
};

interface ChorePlannerProps {
  weather: WeatherData | null;
  nextAppointment: CalendarEvent | null;
  /** Beacon family members supply photos, colours, and display names. */
  members: FamilyMember[];
}

const COPY = {
  nl: {
    title: 'Taakjes & Routines',
    shortTitle: 'Taakjes',
    pause: 'Routines pauzeren',
    resume: 'Routines hervatten',
    paused: 'Alle routines gepauzeerd',
    everyone: 'Iedereen',
    open: 'Open',
    late: 'Te laat',
    done: 'Afgerond',
    today: 'Vandaag',
    weather: 'Weer',
    nextAppointment: 'Volgende afspraak',
    noAppointment: 'Geen afspraken meer vandaag',
    free: 'Vrij te pakken',
    nothing: 'Geen taakjes vandaag 🎉',
    add: 'Taakje toevoegen',
    anyone: 'Wie het eerst is',
    edit: 'Bewerken',
    undo: 'Ongedaan maken',
    remove: 'Verwijderen',
    cancel: 'Annuleren',
    save: 'Opslaan',
    task: 'Taakje',
    routine: 'Routine',
    name: 'Naam',
    points: 'Punten',
    forWho: 'Voor wie',
    freeTask: 'Vrij te pakken door iedereen',
    deadline: 'Deadline',
    todayChip: 'Vandaag',
    tomorrow: 'Morgen',
    retry: 'Herkansing toestaan',
    grace: 'Herkansingstijd (minuten)',
    frequency: 'Frequentie',
    daily: 'Dagelijks',
    weekly: 'Wekelijks',
    monthly: 'Maandelijks',
    interval: 'Aangepast interval',
    time: 'Wanneer',
    morning: 'Ochtend',
    afternoon: 'Middag',
    evening: 'Avond',
    custom: 'Aangepast',
    due: 'Tot',
    claim: 'Pakken',
    expired: 'Vervallen',
    recreate: 'Opnieuw',
    upcoming: 'Start om',
    active: 'Nog',
    retryCopy: 'Je bent te laat, maar je krijgt nog één kans',
    completedAt: 'Afgerond om',
    noFail: 'Niet gelukt, probeer opnieuw',
    pointsReturned: 'Punten teruggezet',
    pauseInfo:
      'Nieuwe routine-taakjes worden niet meer aangemaakt tot je hervat. Bestaande taakjes blijven staan.',
    pauseNow: 'Pauzeren',
    resumeInfo: 'Routines gaan verder vanaf nu. Gemiste taakjes worden niet ingehaald.',
    pot: 'Spaarpot',
    later: 'Later bepalen',
    destination: 'Waar gaan de',
    chooseChild: 'Wie pakt dit taakje?',
    back: 'Terug',
    startMissions: 'Start missies',
    missions: 'Missies',
    continue: 'Verder',
    iDidIt: 'Ik heb het gedaan!',
    pass: 'Geef het bord door',
    todayEarned: 'Vandaag verdiend',
    noMissions: 'Geen taakjes meer. Goed gedaan!',
    action: 'Acties',
    language: 'EN',
    privacy: 'Privacy',
    sound: 'Geluid',
    routines: 'Routines',
    invalid: 'Deze dag bestaat niet in elke maand; de routine wordt dan overgeslagen.',
    potWarning: 'De punten zijn teruggezet naar nul.',
    offline: 'Geen internetverbinding — wijzigingen worden niet opgeslagen',
    assignToClaim: 'Deze taak heeft nog geen ChoreOps-knop; wijs hem eerst toe in Home Assistant.',
    pinTitle: 'Goedkeuring door ouder',
    pinHint: 'Voer de pincode van een ouder in.',
    pinWrong: 'Die pincode klopt niet.',
    pinConfirm: 'Ontgrendelen',
    create: 'Taakje aanmaken',
    sure: 'Zeker weten?',
    score: 'taakjes vandaag',
    description: 'Beschrijving',
    dueAt: 'Vervaldatum en tijd',
    dueWindow: 'Mag al vóór de vervaldatum',
    dueWindowHint: 'Bijv. 1h, 1d 6h of 0 om uit te zetten.',
    reminder: 'Herinnering',
    reminderHint: 'Leeg laten houdt de huidige herinnering.',
    autoApprove: 'Direct goedkeuren, zonder ouder',
    every: 'Elke',
    renameLocked: 'Naam wijzigen kan alleen in ChoreOps.',
    rewards: 'Beloningen',
    noRewards: 'Nog geen beloningen in ChoreOps.',
    newReward: 'Beloning toevoegen',
    cost: 'Kosten (punten)',
    redeem: 'Inwisselen',
    assign: 'Toewijzen',
    assigned: 'Toegewezen · wacht op bevestiging',
    confirm: 'Bevestigen',
    undoShort: 'Terug',
    pointsUnit: 'punten',
    saved: 'gespaard',
    locked: 'nog niet genoeg',
    claimed: 'wacht op goedkeuring',
    savedToast: 'Opgeslagen',
  },
  en: {
    title: 'Chores & Routines',
    shortTitle: 'Chores',
    pause: 'Pause routines',
    resume: 'Resume routines',
    paused: 'All routines paused',
    everyone: 'Everyone',
    open: 'Open',
    late: 'Late',
    done: 'Completed',
    today: 'Today',
    weather: 'Weather',
    nextAppointment: 'Next appointment',
    noAppointment: 'No more appointments today',
    free: 'Free to claim',
    nothing: 'No chores today 🎉',
    add: 'Add a chore',
    anyone: 'Anyone (first)',
    edit: 'Edit',
    undo: 'Undo',
    remove: 'Delete',
    cancel: 'Cancel',
    save: 'Save',
    task: 'Task',
    routine: 'Routine',
    name: 'Name',
    points: 'Points',
    forWho: 'For whom',
    freeTask: 'Free for anyone to claim',
    deadline: 'Deadline',
    todayChip: 'Today',
    tomorrow: 'Tomorrow',
    retry: 'Allow retry',
    grace: 'Grace window (minutes)',
    frequency: 'Frequency',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    interval: 'Custom interval',
    time: 'When',
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    custom: 'Custom',
    due: 'Until',
    claim: 'Claim',
    expired: 'Expired',
    recreate: 'Recreate',
    upcoming: 'Starts at',
    active: 'Remaining',
    retryCopy: 'You are late, but you get one more chance',
    completedAt: 'Completed at',
    noFail: 'Could not save, try again',
    pointsReturned: 'Points returned',
    pauseInfo: 'No new routine tasks will be created until you resume. Existing tasks stay.',
    pauseNow: 'Pause',
    resumeInfo: 'Routines resume from now. Missed tasks will not be backfilled.',
    pot: 'Savings pot',
    later: 'Decide later',
    destination: 'Where should the',
    chooseChild: 'Who is claiming this task?',
    back: 'Back',
    startMissions: 'Start missions',
    missions: 'Missions',
    continue: 'Continue',
    iDidIt: 'I did it!',
    pass: 'Pass the board',
    todayEarned: 'Earned today',
    noMissions: 'No more tasks. Well done!',
    action: 'Actions',
    language: 'NL',
    privacy: 'Privacy',
    sound: 'Sound',
    routines: 'Routines',
    invalid: 'This date does not exist every month; the routine will be skipped.',
    potWarning: 'Points were reset to zero.',
    offline: 'No internet connection — changes will not be saved',
    assignToClaim: 'This chore has no ChoreOps button yet; assign it in Home Assistant first.',
    pinTitle: 'Parent approval',
    pinHint: "Enter a parent's PIN to approve.",
    pinWrong: 'That PIN is not correct.',
    pinConfirm: 'Unlock',
    create: 'Create chore',
    sure: 'Delete for sure?',
    score: 'tasks today',
    description: 'Description',
    dueAt: 'Due date and time',
    dueWindow: 'Becomes available before due',
    dueWindowHint: 'e.g. 1h, 1d 6h — or 0 to disable.',
    reminder: 'Reminder',
    reminderHint: 'Leave empty to keep the current reminder.',
    autoApprove: 'Approve without a parent',
    every: 'Every',
    renameLocked: 'Renaming is only possible in ChoreOps.',
    rewards: 'Rewards',
    noRewards: 'No rewards in ChoreOps yet.',
    newReward: 'Add reward',
    cost: 'Cost (points)',
    redeem: 'Redeem',
    assign: 'Assign',
    assigned: 'Assigned · waiting for confirmation',
    confirm: 'Confirm',
    undoShort: 'Undo',
    pointsUnit: 'points',
    saved: 'saved',
    locked: 'not enough yet',
    claimed: 'awaiting approval',
    savedToast: 'Saved',
  },
} as const;

function localDateTime(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function countdown(target: string | null, now: Date, language: Language): string {
  if (!target) return '';
  const minutes = Math.max(0, Math.ceil((new Date(target).getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return language === 'nl'
    ? `${hours ? `${hours}u ` : ''}${rest}m`
    : `${hours ? `${hours}h ` : ''}${rest}m`;
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
  };
}

export function ChorePlanner({ weather, nextAppointment, members }: ChorePlannerProps) {
  const choreOps = useChoreOps();
  /**
   * ChoreOps is the single source of truth. There is no local chore store any
   * more: the board renders exactly what the integration publishes.
   */
  const view = useMemo(
    () => buildChorePlannerView(choreOps.data, members),
    [choreOps.data, members],
  );
  const data: ChorePlannerState = {
    members: view.members,
    tasks: view.tasks,
    goals: view.goals,
    routines: [],
    routinesPaused: false,
    soundEnabled: true,
  };
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem('beacon_chore_language') === 'en' ? 'en' : 'nl',
  );
  const [screen, setScreen] = useState<Screen>('tasks');
  const [now, setNow] = useState(new Date());
  const [memberFilter, setMemberFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'late' | 'completed'>('all');
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [modal, setModal] = useState<
    'form' | 'actions' | 'rewards' | 'reward-form' | 'reward-actions' | null
  >(null);
  const [form, setForm] = useState<FormValue>(() => emptyForm(new Date()));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [confetti, setConfetti] = useState(false);
  const [goalCelebration, setGoalCelebration] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [todayMemberId, setTodayMemberId] = useState<string | null>(null);
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
  const c = COPY[language];

  useEffect(() => {
    localStorage.setItem('beacon_chore_language', language);
  }, [language]);
  useEffect(() => {
    writeRewardReservations(reservations);
  }, [reservations]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2600);
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

  const filteredTasks = useMemo(
    () =>
      data.tasks.filter((task) => {
        const status = getPlannerTaskStatus(task, now);
        const matchesMember =
          memberFilter === 'all' ||
          task.memberId === memberFilter ||
          (!task.memberId && memberFilter === 'all');
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'open' && status !== 'completed') ||
          (statusFilter === 'late' && (status === 'late' || status === 'retry')) ||
          (statusFilter === 'completed' && status === 'completed');
        return matchesMember && matchesStatus;
      }),
    [data.tasks, memberFilter, now, statusFilter],
  );

  const freeTasks = filteredTasks.filter(
    (task) => !task.memberId && taskStatus(task) !== 'completed',
  );
  const completedTasks = filteredTasks.filter((task) => taskStatus(task) === 'completed');
  const lateTasks = filteredTasks.filter(
    (task) => task.memberId && ['late', 'retry'].includes(taskStatus(task)),
  );
  const todayTasks = filteredTasks.filter(
    (task) => task.memberId && ['active', 'upcoming'].includes(taskStatus(task)),
  );
  const byDeadline = (a: PlannerTask, b: PlannerTask) =>
    new Date(a.deadlineAt ?? a.expiresAt ?? a.startsAt).getTime() -
    new Date(b.deadlineAt ?? b.expiresAt ?? b.startsAt).getTime();

  /** Chores that need attention first, then by deadline. */
  const byUrgency = (a: PlannerTask, b: PlannerTask) => {
    const rank = (task: PlannerTask) =>
      ['late', 'retry', 'expired'].includes(taskStatus(task)) ? 0 : 1;
    return rank(a) - rank(b) || byDeadline(a, b);
  };

  /**
   * The "everyone" board is grouped by child rather than by status: with the
   * whole family on screen a parent wants to see who still has work left, not
   * one long mixed list. Completed chores are grouped the same way so the
   * history stays attributable at a glance.
   */
  const byMember = data.members.map((member) => {
    const mine = filteredTasks.filter((task) => task.memberId === member.id);
    return {
      member,
      open: mine.filter((task) => taskStatus(task) !== 'completed').sort(byUrgency),
      done: mine
        .filter((task) => taskStatus(task) === 'completed')
        .sort((a, b) => byDeadline(b, a)),
    };
  });
  const memberGroups = byMember.filter((group) => group.open.length > 0);
  const completedGroups = byMember.filter((group) => group.done.length > 0);

  /** Avatar + name + count heading, shared by the open and completed groups. */
  const memberHeading = (member: PlannerMember, count: number) => (
    <h2>
      <span className="planner-member-heading-avatar">
        <MemberAvatar member={member} />
      </span>
      {member.name}
      <span className="planner-member-heading-count">{count}</span>
    </h2>
  );

  const showToast = (message: string) => setToast(message);
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
    void runLiveAction(task.id, entityId, task.name);
  };

  /** Press a ChoreOps button and report the outcome, then re-read its entities. */
  const runLiveAction = async (taskId: string, entityId: string, label: string) => {
    if (pendingTaskId) return;
    setPendingTaskId(taskId);
    try {
      await choreOps.pressButton(entityId);
      setConfetti(true);
      playCompletionSound();
      showToast(liveToast(c, label));
      if (screen === 'mission') advanceMission();
    } catch (err) {
      showToast(err instanceof Error ? err.message : c.noFail);
    } finally {
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
    const schedule = {
      frequency,
      customInterval:
        frequency === 'custom' || frequency === 'custom_from_complete'
          ? form.liveInterval
          : undefined,
      customIntervalUnit: form.liveIntervalUnit,
      applicableDays:
        frequency === 'weekly' ? form.liveWeekdays.map((day) => DAY_KEYS[day]) : undefined,
      // ChoreOps rejects a repeat change without a future due date.
      dueDate: form.deadlineAt ? new Date(form.deadlineAt).toISOString() : undefined,
      description: form.liveDescription,
      autoApprove: form.liveAutoApprove,
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
      showToast(`${c.done} \u00b7 ${form.name.trim()}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : c.noFail);
    } finally {
      setSaving(false);
    }
  };

  const removeTask = async (task: PlannerTask) => {
    try {
      await choreOps.deleteChore(task.name);
      setModal(null);
      showToast(`${c.remove} \u00b7 ${task.name}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : c.noFail);
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
          showToast(err instanceof Error ? err.message : c.noFail);
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
        showToast(err instanceof Error ? err.message : c.noFail);
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
        showToast(`${c.remove} \u00b7 ${reward.name}`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : c.noFail);
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
      showToast(c.assignToClaim);
      return;
    }
    setReservations((list) =>
      reservePoints(list, { user: userName, reward: reward.name, points: reward.cost }),
    );
    showToast(`${c.assign} \u00b7 ${reward.name}`);
  };

  /** Give the points back — the child changed their mind about this reward. */
  const undoRewardChoice = (reward: ChoreOpsReward) => {
    setReservations((list) => releasePoints(list, reward.assignee, reward.name));
    showToast(`${c.undoShort} \u00b7 ${reward.name}`);
  };

  /**
   * Parent confirmation in real life: ChoreOps deducts the cost once and the
   * child's allocation is released, so their visible balance does not move.
   */
  const confirmReward = (reward: ChoreOpsReward) => {
    if (!reward.assignee) {
      showToast(c.assignToClaim);
      return;
    }
    requestPin(c.rewards, reward.name, (approverName) => {
      void (async () => {
        try {
          setSaving(true);
          await choreOps.approveReward(reward.assignee as string, reward.name, approverName);
          setReservations((list) => releasePoints(list, reward.assignee, reward.name));
          playCompletionSound();
          showToast(liveToast(c, reward.name));
        } catch (err) {
          showToast(err instanceof Error ? err.message : c.noFail);
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
    const subtitle =
      status === 'upcoming'
        ? `${c.upcoming} ${new Date(task.startsAt).toLocaleTimeString(language === 'nl' ? 'nl-NL' : 'en-US', { hour: '2-digit', minute: '2-digit' })}`
        : status === 'active'
          ? deadline
            ? `${c.active} ${countdown(deadline, now, language)}`
            : c.open
          : status === 'retry'
            ? `${c.retryCopy} · ${countdown(deadline ? new Date(new Date(deadline).getTime() + (task.retryMinutes ?? 0) * 60_000).toISOString() : null, now, language)}`
            : status === 'late'
              ? c.late
              : status === 'expired'
                ? c.expired
                : completedAt
                  ? `${c.completedAt} ${new Date(completedAt).toLocaleTimeString(language === 'nl' ? 'nl-NL' : 'en-US', { hour: '2-digit', minute: '2-digit' })}`
                  : c.done;
    const timeLabel =
      task.timeBlock === 'morning'
        ? c.morning
        : task.timeBlock === 'afternoon'
          ? c.afternoon
          : task.timeBlock === 'evening'
            ? c.evening
            : deadline
              ? `${c.due} ${new Date(deadline).toLocaleTimeString(language === 'nl' ? 'nl-NL' : 'en-US', { hour: '2-digit', minute: '2-digit' })}`
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
          aria-label={status === 'completed' ? c.done : c.task}
          onClick={() => void completeTask(task)}
        >
          {pendingTaskId === task.id ? (
            <span className="planner-spinner" />
          ) : status === 'completed' ? (
            <Check />
          ) : status === 'expired' ? (
            <RotateCcw />
          ) : (
            <span />
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
          {task.points > 0 && <span className="planner-points">⭐ {task.points}</span>}
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
    screen === 'tasks'
      ? c.title
      : screen === 'lobby'
        ? 'Vandaag'
        : screen === 'missions' || screen === 'mission'
          ? c.missions
          : screen === 'closing'
            ? c.todayEarned
            : (selectedTodayMember?.name ?? c.title);

  return (
    <div className={`chore-planner ${privacy ? 'chore-planner--private' : ''}`}>
      <header className="planner-header">
        {screen !== 'tasks' &&
          screen !== 'lobby' &&
          screen !== 'mission' &&
          screen !== 'closing' && (
            <button
              className="planner-icon-button"
              onClick={() =>
                setScreen(
                  screen === 'welcome' ? 'lobby' : screen === 'overview' ? 'welcome' : 'overview',
                )
              }
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
        {screen === 'closing' && (
          <div className="planner-clock">
            {now.toLocaleTimeString(language === 'nl' ? 'nl-NL' : 'en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}
        <h1>
          {/* Phones get the short name so the header can stay on one row. */}
          <span className="planner-title-full">{heading}</span>
          <span className="planner-title-short">{screen === 'tasks' ? c.shortTitle : heading}</span>
        </h1>
        {screen === 'tasks' && (
          <button className="planner-add" onClick={openNewForm} aria-label={c.add}>
            <Plus />
          </button>
        )}
        <button
          className="planner-icon-button planner-language"
          onClick={() => setLanguage(language === 'nl' ? 'en' : 'nl')}
          aria-label="Language"
        >
          {c.language}
        </button>
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
      </header>

      {screen === 'tasks' && (
        <>
          {privacy && (
            <div className="planner-private-clock">
              {now.toLocaleTimeString(language === 'nl' ? 'nl-NL' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          )}
          {!online && (
            <div className="planner-offline-banner" role="alert">
              {c.offline}
            </div>
          )}
          <div className="planner-filters">
            <div className="planner-filter-group">
              <button
                className={memberFilter === 'all' ? 'is-selected' : ''}
                onClick={() => setMemberFilter('all')}
              >
                {c.everyone}
              </button>
              {data.members.map((member) => (
                <button
                  key={member.id}
                  className={memberFilter === member.id ? 'is-selected' : ''}
                  onClick={() => setMemberFilter(member.id)}
                >
                  <span>
                    <MemberAvatar member={member} />
                  </span>
                  {member.name}
                </button>
              ))}
            </div>
            <div className="planner-filter-group planner-status-filters">
              {(['open', 'late', 'completed'] as const).map((filter) => (
                <button
                  key={filter}
                  className={statusFilter === filter ? 'is-selected' : ''}
                  onClick={() => setStatusFilter(statusFilter === filter ? 'all' : filter)}
                >
                  {filter === 'open' ? c.open : filter === 'late' ? c.late : c.done}
                </button>
              ))}
            </div>
          </div>
          <main className="planner-content">
            {freeTasks.length > 0 && (
              <section className="planner-section planner-free-section">
                <h2>
                  {c.free}
                  <span>{freeTasks.length}</span>
                </h2>
                <div className="planner-task-list">
                  {freeTasks.sort(byDeadline).map((task) => renderTask(task))}
                </div>
              </section>
            )}
            {memberFilter === 'all'
              ? memberGroups.map(({ member, open }) => (
                  <section
                    className="planner-section planner-section--member"
                    key={member.id}
                    style={{ '--member-color': member.color } as React.CSSProperties}
                  >
                    {memberHeading(member, open.length)}
                    <div className="planner-task-list">{open.map((task) => renderTask(task))}</div>
                  </section>
                ))
              : [section(c.today, todayTasks), section(c.late, lateTasks, 'planner-section--late')]}
            <section className="planner-section planner-section--completed">
              <button
                className="planner-collapse"
                onClick={() => setCompletedExpanded((value) => !value)}
              >
                <span>
                  {c.done} ({completedTasks.length})
                </span>
                {completedExpanded ? <ChevronDown /> : <ChevronRight />}
              </button>
              {completedExpanded &&
                (memberFilter === 'all' ? (
                  <div className="planner-completed-groups">
                    {completedGroups.map(({ member, done }) => (
                      <section
                        className="planner-section planner-section--member planner-section--member-done"
                        key={member.id}
                        style={{ '--member-color': member.color } as React.CSSProperties}
                      >
                        {memberHeading(member, done.length)}
                        <div className="planner-task-list">
                          {done.map((task) => renderTask(task))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="planner-task-list">
                    {completedTasks.sort(byDeadline).map((task) => renderTask(task))}
                  </div>
                ))}
            </section>
            {freeTasks.length + todayTasks.length + lateTasks.length + completedTasks.length ===
              0 && (
              <div className="planner-empty">
                <Sparkles />
                <strong>{c.nothing}</strong>
                <button className="planner-primary" onClick={openNewForm}>
                  {c.add}
                </button>
              </div>
            )}
            {data.routines.length > 0 && (
              <section className="planner-routines">
                <h2>{c.routines}</h2>
                <div>
                  {data.routines.map((routine) => (
                    <div key={routine.id} className="planner-routine-row">
                      <span>{routine.icon}</span>
                      <strong>{routine.name}</strong>
                      <small>{routine.frequency === 'daily' ? c.daily : routine.frequency}</small>
                      <span>
                        {routine.timeBlock === 'morning'
                          ? c.morning
                          : routine.timeBlock === 'evening'
                            ? c.evening
                            : c.afternoon}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </main>
        </>
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
                setScreen('welcome');
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
      {screen === 'welcome' && selectedTodayMember && (
        <main className="planner-today-step">
          <span
            className="planner-hero-avatar"
            style={{ background: selectedTodayMember.color + '24' }}
          >
            <MemberAvatar member={selectedTodayMember} />
          </span>
          <p className="planner-eyebrow">
            {now.toLocaleDateString(language === 'nl' ? 'nl-NL' : 'en-US', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          <h2>
            {language === 'nl'
              ? `Goedemorgen, ${selectedTodayMember.name}`
              : `Good morning, ${selectedTodayMember.name}`}
          </h2>
          <p>
            {memberTodayCount(selectedTodayMember.id)} {c.score}
          </p>
          <div className="planner-today-info">
            <span>
              <strong>{c.weather}</strong>
              {weather
                ? `${Math.round(weather.temperature)}${weather.temperatureUnit} · ${weather.condition}`
                : '—'}
            </span>
            <span>
              <strong>{c.nextAppointment}</strong>
              {nextAppointment
                ? `${nextAppointment.title} · ${new Date(nextAppointment.start).toLocaleTimeString(language === 'nl' ? 'nl-NL' : 'en-US', { hour: '2-digit', minute: '2-digit' })}`
                : c.noAppointment}
            </span>
          </div>
          <button className="planner-primary" onClick={() => setScreen('overview')}>
            {c.continue}
            <ChevronRight />
          </button>
        </main>
      )}
      {screen === 'overview' && selectedTodayMember && (
        <main className="planner-today-step">
          <p className="planner-eyebrow">02 / 04</p>
          <h2>
            {language === 'nl'
              ? `Dit staat er voor je klaar, ${selectedTodayMember.name}`
              : `Here is your day, ${selectedTodayMember.name}`}
          </h2>
          <div className="planner-overview-stats">
            <span>
              <strong>{memberTodayCount(selectedTodayMember.id)}</strong>
              {c.score}
            </span>
            <span>
              <strong>⭐ {spendableFor(selectedTodayMember)}</strong>
              {c.pot}
            </span>
          </div>
          {rewardsForMember(selectedTodayMember.id).length > 0 && (
            <section className="planner-child-rewards">
              <h3>{c.rewards}</h3>
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
                            () => void runLiveAction(reward.id, approveId, reward.name),
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
                );
              })}
            </section>
          )}
          <button className="planner-primary" onClick={() => setScreen('missions')}>
            {c.continue}
            <ChevronRight />
          </button>
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
              {missionIndex + 1} {language === 'nl' ? 'van' : 'of'} {missionIds.length}
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
                  : `${c.active} ${countdown(missionTask.deadlineAt, now, language)}`}
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
        <main className="planner-today-step">
          <span
            className="planner-hero-avatar"
            style={{ background: selectedTodayMember.color + '24' }}
          >
            <MemberAvatar member={selectedTodayMember} />
          </span>
          <p className="planner-eyebrow">04 / 04</p>
          <h2>
            {c.todayEarned}: ⭐ {completedTodayPoints(selectedTodayMember.id)}
          </h2>
          <p>
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

      <nav className="planner-bottom-nav" aria-label="Chore planner">
        <button
          className={screen === 'tasks' ? 'is-active' : ''}
          onClick={() => setScreen('tasks')}
        >
          <span>✓</span>
          <strong>{c.shortTitle}</strong>
        </button>
        <button
          className={screen !== 'tasks' ? 'is-active' : ''}
          onClick={() => setScreen('lobby')}
        >
          <span>☀</span>
          <strong>Vandaag</strong>
        </button>
      </nav>

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
                          {FREQUENCY_LABEL[language][frequency] ?? frequency}
                        </option>
                      ))}
                    </select>
                  </label>
                  {form.liveFrequency === 'weekly' && (
                    <div className="planner-weekdays">
                      {['M', 'D', 'W', 'D', 'V', 'Z', 'Z'].map((day, index) => (
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
                          {day}
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
                              {UNIT_LABEL[language][unit]}
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
                                () => void runLiveAction(reward.id, approveId, reward.name),
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
        <div className="planner-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
