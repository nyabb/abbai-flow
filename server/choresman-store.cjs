/**
 * ChoresMan is Abbai Flow's local, JSON-backed chore and rewards module.
 *
 * Its service-shaped action names and snake_case payloads are part of the
 * local HTTP API. Family members are first-class Abbai Flow records and have
 * no external account identity link.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const FILE_QUEUES = new Map();

const SCHEMA_VERSION = 2;
const SERVICE_NAMES = [
  'pause_user_chores',
  'create_chore',
  'update_chore',
  'delete_chore',
  'take_chore',
  'claim_chore',
  'approve_chore',
  'disapprove_chore',
  'set_chore_due_date',
  'skip_chore_due_date',
  'create_reward',
  'approve_reward_definition',
  'update_reward',
  'delete_reward',
  'redeem_reward',
  'approve_reward',
  'disapprove_reward',
  'manual_adjust_points',
  'get_ledger',
  'apply_bonus',
  'apply_penalty',
  'generate_activity_report',
  'reschedule_chores_after',
  'reset_overdue_chores',
  'reset_chores_to_pending_state',
  'reset_transactional_data',
  'remove_awarded_badges',
  'repair_badge_streak',
  'manage_ui_control',
  'set_rotation_turn',
  'reset_rotation',
  'open_rotation_cycle',
  // ChoresMan-local configuration and delivery-neutral extensions.
  'create_bonus', 'update_bonus', 'delete_bonus',
  'create_penalty', 'update_penalty', 'delete_penalty',
  'create_badge', 'update_badge', 'delete_badge', 'award_badge',
  'create_achievement', 'update_achievement', 'delete_achievement',
  'create_challenge', 'update_challenge', 'delete_challenge',
  'run_scheduled_maintenance', 'get_notifications', 'acknowledge_notification',
];
const FAMILY_SERVICE_NAMES = ['create_member', 'update_member', 'delete_member', 'sync_members'];

const FREQUENCIES = new Set([
  'none',
  'daily',
  'daily_multi',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
  'custom_from_complete',
  'custom_from_complete_date_only',
  'week_end',
  'month_end',
  'quarter_end',
  'year_end',
]);
const INTERVAL_UNITS = new Set(['hours', 'days', 'weeks', 'months']);
const COMPLETION_CRITERIA = new Set([
  'independent', 'shared_first', 'shared_all', 'rotation_simple',
  'rotation_simple_from_turn_holder', 'rotation_smart', 'primary_standby',
]);
const ROTATION_CRITERIA = new Set([
  'rotation_simple', 'rotation_simple_from_turn_holder', 'rotation_smart', 'primary_standby',
]);
const APPROVAL_RESET_TYPES = new Set(['at_midnight_once', 'at_midnight_multi', 'at_due_date', 'upon_completion', 'manual_reset_only']);
const PENDING_CLAIM_ACTIONS = new Set(['hold_pending', 'clear_pending', 'auto_approve_pending']);
const GOAL_TYPES = new Set(['cumulative', 'periodic', 'daily', 'special', 'linked']);
const GOAL_METRICS = new Set(['points', 'points_earned', 'count', 'completions', 'days', 'streak']);
const WEEKDAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const ASSIGN_ALL = '*';
const isNeverOverdue = (value) => /never[_\s-]?overdue/i.test(String(value || ''));
const MAX_NOTIFICATION_TTL_SECONDS = 28 * 24 * 60 * 60;
const MEMBER_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#a855f7',
  '#f97316',
  '#ec4899',
  '#14b8a6',
  '#eab308',
  '#ef4444',
  '#6366f1',
  '#06b6d4',
];

const CHORE_FIELDS = [
  'points',
  'description',
  'icon',
  'labels',
  'frequency',
  'custom_interval',
  'custom_interval_unit',
  'applicable_days',
  'completion_criteria',
  'approval_reset_type',
  'pending_claims',
  'overdue_handling',
  'chore_claim_lock_until_window',
  'auto_approve',
  'due_date',
  'due_window_offset',
  'due_reminder_offset',
  'notify_on_claim',
  'notify_on_approval',
  'notify_on_disapproval',
  'notify_on_overdue',
  'notify_on_due_window',
  'notify_due_reminder',
  'notification_channel',
  'notification_importance',
  'notification_priority',
  'notification_ttl',
  'standby_claim_mode',
  'allow_steal',
  'daily_multi_times',
  'daily_multi_times_by_member',
  'applicable_days_by_member',
  'show_on_calendar',
];

const REWARD_FIELDS = ['cost', 'description', 'icon', 'labels'];

function emptyDocument() {
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: null,
    members: [],
    chores: [],
    chore_claims: [],
    chore_events: [],
    rewards: [],
    reward_claims: [],
    ledger: [],
    bonuses: [],
    penalties: [],
    badges: [],
    badge_awards: [],
    badge_progress: [],
    achievements: [],
    challenges: [],
    goal_progress: [],
    notifications: [],
    ui_controls: [],
  };
}

function migrateDocument(document) {
  if (!document || typeof document !== 'object') return document;
  if (document.schema_version === 1) {
    const migrated = { ...emptyDocument(), ...document, schema_version: SCHEMA_VERSION };
    for (const field of Object.keys(emptyDocument())) {
      if (field !== 'schema_version' && !Array.isArray(migrated[field]) && Array.isArray(emptyDocument()[field])) {
        migrated[field] = [];
      }
    }
    for (const member of migrated.members) {
      if (!Object.hasOwn(member, 'gamification_enabled')) member.gamification_enabled = true;
      if (!member.notification_preferences || typeof member.notification_preferences !== 'object') {
        member.notification_preferences = { enabled: true };
      }
    }
    for (const chore of migrated.chores) {
      if (!chore.due_date_by_member) chore.due_date_by_member = {};
      if (!chore.rotation_state) chore.rotation_state = { current_member_id: chore.assigned_member_ids?.[0] || null, open: false };
      if (!chore.last_reset_key_by_member) chore.last_reset_key_by_member = {};
    }
    return migrated;
  }
  return document;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normaliseName(value, label = 'name') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ChoresManStoreError('invalid_data', `${label} is required`);
  }
  return value.trim();
}

function nameKey(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function finiteNumber(value, label, { min = -Infinity, max = Infinity, decimals = 2 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ChoresManStoreError('invalid_data', `${label} must be a finite number`);
  }
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function decimalNumber(value, label, decimals) {
  const number = Number(value);
  const factor = 10 ** decimals;
  if (!Number.isFinite(number) || Math.abs(number * factor - Math.round(number * factor)) > 1e-8) {
    throw new ChoresManStoreError('invalid_data', `${label} must have at most ${decimals} decimal places`);
  }
  return Math.round(number * factor) / factor;
}

function stringList(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    throw new ChoresManStoreError('invalid_data', `${label} must be an array of strings`);
  }
  const values = [...new Set(value.map((item) => normaliseName(item, label)))];
  if (!allowEmpty && values.length === 0) {
    throw new ChoresManStoreError('invalid_data', `${label} must contain at least one value`);
  }
  return values;
}

function isoNow(now) {
  const date = now();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new ChoresManStoreError('invalid_clock', 'The configured clock returned an invalid date');
  }
  return date.toISOString();
}

function parseDate(value, label = 'date') {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ChoresManStoreError('invalid_data', `${label} must be a valid date`);
  }
  return date;
}

function dateKey(dateValue) {
  return new Date(dateValue).toISOString().slice(0, 10);
}

function monthKey(dateValue) {
  return new Date(dateValue).toISOString().slice(0, 7);
}

function quarterKey(dateValue) {
  const date = new Date(dateValue);
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

function startOfIsoWeek(dateValue) {
  const date = new Date(dateValue);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return dateKey(date);
}

function durationMilliseconds(value, label) {
  if (value === null || value === undefined || value === '') return 0;
  const text = String(value).trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 60_000;
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m)/g)];
  if (
    parts.length === 0 ||
    parts.map((part) => part[0]).join('').replace(/\s/g, '') !== text.replace(/\s/g, '')
  ) {
    throw new ChoresManStoreError(
      'invalid_data',
      `${label} must use minutes or a duration such as 1d 2h 30m`,
    );
  }
  return parts.reduce((total, part) => {
    const multiplier = part[2] === 'd' ? 86_400_000 : part[2] === 'h' ? 3_600_000 : 60_000;
    return total + Number(part[1]) * multiplier;
  }, 0);
}

function nextWeeklyDate(chore, baseValue) {
  const base = new Date(baseValue);
  const days = (chore.applicable_days || [])
    .map((day) => WEEKDAY_INDEX[day])
    .filter((day) => day !== undefined);
  if (days.length === 0) {
    const next = new Date(base);
    next.setUTCDate(next.getUTCDate() + 7);
    return next.toISOString();
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(base);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    if (days.includes(candidate.getUTCDay())) return candidate.toISOString();
  }
  return null;
}

function cycleKey(chore, memberId, nowDate) {
  const frequency = chore.frequency || 'none';
  const memberDue = chore.due_date_by_member?.[memberId];
  const dueDate = memberDue || chore.due_date;
  if (dueDate && frequency === 'daily_multi') {
    const date = new Date(dueDate);
    return `${dateKey(date)}@${date.toISOString().slice(11, 16)}`;
  }
  if (dueDate && !['daily', 'daily_multi'].includes(frequency)) return dateKey(dueDate);

  switch (frequency) {
    case 'daily':
      return dateKey(nowDate);
    case 'daily_multi': {
      const configured = chore.daily_multi_times_by_member?.[memberId] || chore.daily_multi_times || [];
      const times = normaliseTimes(configured, 'daily_multi_times');
      if (times.length === 0) return dateKey(nowDate);
      const currentMinutes = nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
      const eligible = times.filter((time) => {
        const [hour, minute] = time.split(':').map(Number);
        return hour * 60 + minute <= currentMinutes;
      });
      const time = eligible.at(-1) || times[0];
      return `${dateKey(nowDate)}@${time}`;
    }
    case 'weekly':
      return startOfIsoWeek(nowDate);
    case 'biweekly': {
      const anchor = chore.created_at || nowDate.toISOString();
      const elapsedDays = Math.floor(
        (Date.parse(dateKey(nowDate)) - Date.parse(dateKey(anchor))) / 86400000,
      );
      return `biweekly-${Math.floor(Math.max(0, elapsedDays) / 14)}`;
    }
    case 'monthly':
    case 'month_end':
      return monthKey(nowDate);
    case 'quarterly':
    case 'quarter_end':
      return quarterKey(nowDate);
    case 'yearly':
    case 'year_end':
      return String(nowDate.getUTCFullYear());
    case 'week_end':
      return startOfIsoWeek(nowDate);
    case 'custom':
    case 'custom_from_complete':
    case 'custom_from_complete_date_only':
      return dueDate ? dateKey(dueDate) : dateKey(chore.created_at || nowDate);
    default:
      return dueDate ? dateKey(dueDate) : 'once';
  }
}

function addMonthsClamped(dateValue, count) {
  const source = new Date(dateValue);
  const day = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  target.setUTCHours(source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), 0);
  return target;
}

function nextDueDate(chore, baseValue, memberId = null) {
  const base = parseDate(baseValue) || new Date(chore.due_date || chore.created_at);
  const next = new Date(base);
  const frequency = chore.frequency || 'none';

  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'daily_multi': {
      const times = normaliseTimes(
        chore.daily_multi_times_by_member?.[memberId] || chore.daily_multi_times || [],
        'daily_multi_times',
      );
      if (times.length === 0) {
        next.setUTCDate(next.getUTCDate() + 1);
        break;
      }
      for (let offset = 0; offset <= 1; offset += 1) {
        for (const time of times) {
          const [hour, minute] = time.split(':').map(Number);
          const candidate = new Date(base);
          candidate.setUTCDate(candidate.getUTCDate() + offset);
          candidate.setUTCHours(hour, minute, 0, 0);
          if (candidate.getTime() > base.getTime()) return candidate.toISOString();
        }
      }
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    }
    case 'weekly':
      return nextWeeklyDate(chore, base);
    case 'biweekly':
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case 'monthly':
      return addMonthsClamped(base, 1).toISOString();
    case 'quarterly':
      return addMonthsClamped(base, 3).toISOString();
    case 'yearly':
      return addMonthsClamped(base, 12).toISOString();
    case 'custom':
    case 'custom_from_complete':
    case 'custom_from_complete_date_only': {
      const interval = Math.max(1, Number(chore.custom_interval) || 1);
      const unit = chore.custom_interval_unit || 'days';
      if (unit === 'hours') next.setUTCHours(next.getUTCHours() + interval);
      else if (unit === 'weeks') next.setUTCDate(next.getUTCDate() + interval * 7);
      else if (unit === 'months') return addMonthsClamped(base, interval).toISOString();
      else next.setUTCDate(next.getUTCDate() + interval);
      break;
    }
    case 'week_end': {
      const daysUntilSunday = (7 - next.getUTCDay()) % 7 || 7;
      next.setUTCDate(next.getUTCDate() + daysUntilSunday);
      break;
    }
    case 'month_end': {
      const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
      if (end.getTime() <= base.getTime()) end.setUTCMonth(end.getUTCMonth() + 1, 0);
      end.setUTCHours(base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), 0);
      return end.toISOString();
    }
    case 'quarter_end': {
      let endMonth = Math.floor(base.getUTCMonth() / 3) * 3 + 2;
      let end = new Date(Date.UTC(base.getUTCFullYear(), endMonth + 1, 0));
      if (end.getTime() <= base.getTime()) {
        endMonth += 3;
        end = new Date(Date.UTC(base.getUTCFullYear(), endMonth + 1, 0));
      }
      end.setUTCHours(base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), 0);
      return end.toISOString();
    }
    case 'year_end': {
      const end = new Date(Date.UTC(base.getUTCFullYear(), 11, 31));
      if (end.getTime() <= base.getTime()) end.setUTCFullYear(end.getUTCFullYear() + 1);
      end.setUTCHours(base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), 0);
      return end.toISOString();
    }
    default:
      return null;
  }
  return next.toISOString();
}

function normaliseTimes(value, label) {
  const source = typeof value === 'string' ? value.split('|') : value;
  if (!Array.isArray(source)) {
    throw new ChoresManStoreError('invalid_data', `${label} must be an array or pipe-separated HH:MM string`);
  }
  const times = [...new Set(source.map((item) => {
    const time = String(item).trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new ChoresManStoreError('invalid_data', `${label} entries must use HH:MM`);
    }
    return time;
  }))].sort();
  return times;
}

function metricKind(value) {
  const metric = String(value || 'count').trim().toLowerCase();
  if (metric.includes('point')) return 'points';
  if (metric.includes('streak')) return 'streak';
  if (metric.includes('day')) return 'days';
  if (metric.includes('overdue')) return 'no_overdue';
  if (metric.includes('count') || metric.includes('completion') || metric.includes('chore')) return 'count';
  if (GOAL_METRICS.has(metric)) return metric;
  throw new ChoresManStoreError('invalid_data', `Unsupported goal metric: ${value}`);
}

class ChoresManStoreError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ChoresManStoreError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

class ChoresManStore {
  constructor(options = {}) {
    const dataDir = options.dataDir || process.env.ABBAI_FLOW_DATA || '/data';
    this.filePath = path.resolve(options.filePath || path.join(dataDir, 'choresman.json'));
    this.now = options.now || (() => new Date());
    this.idFactory = options.idFactory || randomUUID;
  }

  _serialise(work) {
    const current = FILE_QUEUES.get(this.filePath) || Promise.resolve();
    const result = current.then(work, work);
    FILE_QUEUES.set(this.filePath, result.then(
      () => undefined,
      () => undefined,
    ));
    return result;
  }

  async _readDocument() {
    let raw;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return emptyDocument();
      throw error;
    }

    let document;
    try {
    document = migrateDocument(JSON.parse(raw));
    } catch {
      throw new ChoresManStoreError('storage_corrupt', 'ChoresMan JSON data is not valid JSON');
    }
    if (
      !document ||
      typeof document !== 'object' ||
      document.schema_version !== SCHEMA_VERSION ||
      !Array.isArray(document.members) ||
      !Array.isArray(document.chores) ||
      !Array.isArray(document.chore_claims) ||
      !Array.isArray(document.chore_events) ||
      !Array.isArray(document.rewards) ||
      !Array.isArray(document.reward_claims) ||
      !Array.isArray(document.ledger) ||
      !Array.isArray(document.bonuses) ||
      !Array.isArray(document.penalties) ||
      !Array.isArray(document.badges) ||
      !Array.isArray(document.badge_awards) ||
      !Array.isArray(document.badge_progress) ||
      !Array.isArray(document.achievements) ||
      !Array.isArray(document.challenges) ||
      !Array.isArray(document.goal_progress) ||
      !Array.isArray(document.notifications) ||
      !Array.isArray(document.ui_controls)
    ) {
      throw new ChoresManStoreError(
        'storage_version',
        'ChoresMan JSON data has an unsupported or invalid schema',
      );
    }
    return document;
  }

  async _writeDocument(document) {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.${process.pid}.${this.idFactory()}.tmp`;
    let handle;
    try {
      handle = await fs.open(tempPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tempPath, this.filePath);
      try {
        await fs.chmod(this.filePath, 0o600);
      } catch {
        // Some filesystems do not support chmod; the temp file was created private.
      }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  async _read() {
    await (FILE_QUEUES.get(this.filePath) || Promise.resolve());
    return this._readDocument();
  }

  async _mutate(mutator) {
    return this._serialise(async () => {
      const document = await this._readDocument();
      const result = await mutator(document);
      document.updated_at = isoNow(this.now);
      await this._writeDocument(document);
      return clone(result);
    });
  }

  _findMember(document, { user_id: userId, user_name: userName, name } = {}, { active = true } = {}) {
    const targetId = userId || null;
    const targetName = userName || name || null;
    const member = document.members.find((candidate) => {
      if (targetId) return candidate.id === targetId;
      if (targetName) return nameKey(candidate.name) === nameKey(targetName);
      return false;
    });
    if (!member || (active && !member.active)) {
      throw new ChoresManStoreError('user_not_found', `Family member not found: ${targetName || targetId || ''}`);
    }
    return member;
  }

  _findChore(document, { id, chore_id: choreId, name, chore_name: choreName } = {}) {
    const targetId = id || choreId || null;
    const targetName = choreName || name || null;
    const chore = document.chores.find((candidate) => {
      if (targetId) return candidate.id === targetId;
      if (targetName) return nameKey(candidate.name) === nameKey(targetName);
      return false;
    });
    if (!chore) {
      throw new ChoresManStoreError('chore_not_found', `Chore not found: ${targetName || targetId || ''}`);
    }
    return chore;
  }

  _findReward(document, { id, reward_id: rewardId, name, reward_name: rewardName } = {}) {
    const targetId = id || rewardId || null;
    const targetName = rewardName || name || null;
    const reward = document.rewards.find((candidate) => {
      if (targetId) return candidate.id === targetId;
      if (targetName) return nameKey(candidate.name) === nameKey(targetName);
      return false;
    });
    if (!reward) {
      throw new ChoresManStoreError('reward_not_found', `Reward not found: ${targetName || targetId || ''}`);
    }
    return reward;
  }

  _resolveAssignees(document, names, { allowEmpty = false } = {}) {
    const clean = stringList(names, 'assigned_user_names', { allowEmpty });
    if (clean.some((name) => name === ASSIGN_ALL)) return [ASSIGN_ALL];
    const members = clean.map((name) => this._findMember(document, { user_name: name }));
    return [...new Set(members.map((member) => member.id))];
  }

  _memberNames(document, assignedIds) {
    if (assignedIds.includes(ASSIGN_ALL)) return [ASSIGN_ALL];
    return assignedIds
      .map((id) => document.members.find((member) => member.id === id))
      .filter((member) => member && member.active)
      .map((member) => member.name);
  }

  _balance(document, memberId) {
    return Math.round(
      document.ledger
        .filter((entry) => entry.member_id === memberId)
        .reduce((total, entry) => total + entry.amount, 0) * 100,
    ) / 100;
  }

  _appendLedger(document, member, amount, { source, sourceLabel, itemName, referenceId, approverName }) {
    const rounded = finiteNumber(amount, 'amount', { decimals: 2 });
    const entry = {
      id: this.idFactory(),
      timestamp: isoNow(this.now),
      member_id: member.id,
      user_name: member.name,
      amount: rounded,
      balance_after: Math.round((this._balance(document, member.id) + rounded) * 100) / 100,
      source,
      source_label: sourceLabel,
      item_name: itemName,
      reference_id: referenceId || null,
      ...(approverName ? { approver_name: approverName } : {}),
    };
    document.ledger.push(entry);
    return entry;
  }

  _event(document, event) {
    document.chore_events.push({ id: this.idFactory(), timestamp: isoNow(this.now), ...event });
  }

  _queueNotification(document, member, { type, title, message, referenceId, action = null, dedupeKey = null }) {
    if (!member?.active || member.notification_preferences?.enabled === false) return null;
    if (dedupeKey) {
      const existing = document.notifications.find((item) => item.dedupe_key === dedupeKey && !item.cleared_at);
      if (existing) return existing;
    }
    const claim = document.chore_claims.find((entry) => entry.id === referenceId);
    const chore = document.chores.find((entry) =>
      entry.id === referenceId || (claim && entry.id === claim.chore_id),
    );
    const notification = {
      id: this.idFactory(),
      type,
      title,
      message,
      member_id: member.id,
      user_name: member.name,
      reference_id: referenceId || null,
      action,
      channel: chore?.notification_channel || member.notification_preferences?.channel || null,
      importance: chore?.notification_importance || member.notification_preferences?.importance || null,
      priority: chore?.notification_priority || member.notification_preferences?.priority || null,
      ttl: chore?.notification_ttl ?? member.notification_preferences?.ttl ?? null,
      created_at: isoNow(this.now),
      status: 'pending',
      ...(dedupeKey ? { dedupe_key: dedupeKey } : {}),
    };
    document.notifications.push(notification);
    return notification;
  }

  _queueForParents(document, details) {
    for (const member of document.members.filter((candidate) => candidate.active && candidate.role === 'parent')) {
      this._queueNotification(document, member, {
        ...details,
        ...(details.dedupeKey ? { dedupeKey: `${details.dedupeKey}:${member.id}` } : {}),
      });
    }
  }

  _clearNotifications(document, referenceId) {
    const timestamp = isoNow(this.now);
    for (const notification of document.notifications) {
      if (notification.reference_id === referenceId && !notification.cleared_at) {
        notification.status = 'cleared';
        notification.cleared_at = timestamp;
      }
    }
  }

  _rotationMembers(document, chore) {
    if (chore.assigned_member_ids.includes(ASSIGN_ALL)) {
      return document.members.filter((member) => member.active).map((member) => member.id);
    }
    return chore.assigned_member_ids.filter((id) => document.members.some((member) => member.id === id && member.active));
  }

  _isPaused(document, memberId) {
    const member = document.members.find((candidate) => candidate.id === memberId);
    return Boolean(member?.paused && (!member.paused_until || Date.parse(member.paused_until) > Date.parse(this.now())));
  }

  _rotationTurn(document, chore) {
    chore.rotation_state ||= { current_member_id: null, open: false };
    const members = this._rotationMembers(document, chore);
    if (members.length === 0) return null;
    if (chore.completion_criteria === 'primary_standby') {
      const primary = members[0];
      if (!this._isPaused(document, primary)) return primary;
      const standby = members.slice(1).filter((id) => !this._isPaused(document, id));
      return standby.includes(chore.rotation_state.current_member_id)
        ? chore.rotation_state.current_member_id
        : standby[0] || null;
    }
    const current = chore.rotation_state.current_member_id;
    if (members.includes(current) && !this._isPaused(document, current)) return current;
    const index = members.indexOf(current);
    for (let step = 1; step <= members.length; step += 1) {
      const candidate = members[(Math.max(index, -1) + step) % members.length];
      if (!this._isPaused(document, candidate)) return candidate;
    }
    return null;
  }

  _advanceRotation(document, chore, completedMemberId) {
    if (!ROTATION_CRITERIA.has(chore.completion_criteria)) return;
    chore.rotation_state ||= { current_member_id: null, open: false };
    const members = this._rotationMembers(document, chore);
    const active = members.filter((id) => !this._isPaused(document, id));
    if (active.length === 0) return;
    if (chore.completion_criteria === 'primary_standby') {
      const primary = members[0];
      if (!this._isPaused(document, primary)) chore.rotation_state.current_member_id = primary;
      else {
        const standby = members.slice(1).filter((id) => !this._isPaused(document, id));
        const currentIndex = standby.indexOf(chore.rotation_state.current_member_id);
        chore.rotation_state.current_member_id = standby[(currentIndex + 1 + standby.length) % standby.length] || standby[0];
      }
    } else if (chore.completion_criteria === 'rotation_smart') {
      const counts = new Map(active.map((id) => [id, 0]));
      for (const claim of document.chore_claims) {
        if (claim.chore_id === chore.id && claim.status === 'approved' && counts.has(claim.member_id)) {
          counts.set(claim.member_id, counts.get(claim.member_id) + 1);
        }
      }
      const ordered = [...active].sort((left, right) => counts.get(left) - counts.get(right) || members.indexOf(left) - members.indexOf(right));
      chore.rotation_state.current_member_id = ordered[0];
    } else {
      const anchor = chore.completion_criteria === 'rotation_simple_from_turn_holder'
        ? chore.rotation_state.current_member_id
        : completedMemberId;
      const index = members.indexOf(anchor);
      for (let step = 1; step <= members.length; step += 1) {
        const candidate = members[(Math.max(index, -1) + step) % members.length];
        if (!this._isPaused(document, candidate)) {
          chore.rotation_state.current_member_id = candidate;
          break;
        }
      }
    }
    chore.rotation_state.open = false;
    chore.updated_at = isoNow(this.now);
  }

  _effectiveMultiplier(document, memberId) {
    const earned = document.ledger
      .filter((entry) => entry.member_id === memberId && entry.amount > 0)
      .reduce((sum, entry) => sum + entry.amount, 0);
    return document.badges
      .filter((badge) => badge.type === 'cumulative' && (!badge.assigned_member_ids || badge.assigned_member_ids.includes(ASSIGN_ALL) || badge.assigned_member_ids.includes(memberId)) && earned >= Number(badge.threshold_value || badge.target_value || Infinity))
      .reduce((highest, badge) => {
        const configured = (badge.awards || []).filter((award) => award.type === 'multiplier').map((award) => Number(award.value || award.amount || 1));
        return Math.max(highest, Number(badge.multiplier || 1), ...configured);
      }, 1);
  }

  _awardPoints(document, member, amount, { source, sourceLabel, itemName, referenceId, approverName, multiplier = false }) {
    const base = finiteNumber(amount, 'amount', { min: 0 });
    const earned = multiplier ? Math.round(base * this._effectiveMultiplier(document, member.id) * 100) / 100 : base;
    const entry = this._appendLedger(document, member, earned, { source, sourceLabel, itemName, referenceId, approverName });
    return { points_awarded: earned, ledger_entry: entry };
  }

  _automaticallyApproveClaim(document, chore, member, claim, { advanceDueDate = true } = {}) {
    const timestamp = isoNow(this.now);
    claim.status = 'approved';
    claim.approved_at = timestamp;
    claim.approver_name = 'Automatic';
    const award = this._awardPoints(document, member, chore.points, {
      source: 'chore', sourceLabel: 'Chore completion', itemName: chore.name,
      referenceId: claim.id, approverName: 'Automatic', multiplier: true,
    });
    claim.points_awarded = award.points_awarded;
    this._event(document, { type: 'chore_approved', chore_id: chore.id, member_id: member.id, user_name: member.name, claim_id: claim.id, points_awarded: award.points_awarded, automatic: true });
    this._evaluateGoals(document, { member, chore, points: award.points_awarded, timestamp, claimId: claim.id });
    this._advanceRotation(document, chore, member.id);
    const resetType = chore.approval_reset_type || 'upon_completion';
    if (advanceDueDate && (resetType === 'upon_completion' || (resetType === 'at_due_date' && claim.due_date_at_claim && Date.parse(claim.due_date_at_claim) <= Date.parse(timestamp)))) {
      this._advanceChoreDate(document, chore, member.id, timestamp);
    }
    this._clearNotifications(document, claim.id);
    if (chore.notify_on_approval !== false) this._queueNotification(document, member, {
      type: 'chore_approved', title: `${chore.name} approved`, message: `You earned ${award.points_awarded} points.`, referenceId: claim.id,
    });
    return claim;
  }

  _isAssigned(chore, memberId) {
    return chore.assigned_member_ids.includes(ASSIGN_ALL) || chore.assigned_member_ids.includes(memberId);
  }

  _effectiveDueDate(chore, memberId) {
    return chore.due_date_by_member?.[memberId] ?? chore.due_date ?? null;
  }

  _claimFor(document, chore, member, nowDate) {
    const occurrence = cycleKey(chore, member.id, nowDate);
    return document.chore_claims.find(
      (claim) =>
        claim.chore_id === chore.id &&
        claim.member_id === member.id &&
        claim.occurrence === occurrence,
    );
  }

  async getDocument() {
    return clone(await this._read());
  }

  async getSnapshot() {
    const document = await this._read();
    const members = document.members.map((member) => ({
      ...member,
      points: this._balance(document, member.id),
    }));
    const chores = document.chores.map((chore) => ({
      ...chore,
      assigned_user_names: this._memberNames(document, chore.assigned_member_ids),
      current_turn_user_name: document.members.find((member) => member.id === this._rotationTurn(document, chore))?.name || null,
      due_date: chore.due_date,
      due_date_by_member_name: Object.fromEntries(
        Object.entries(chore.due_date_by_member || {}).map(([memberId, dueDate]) => [
          document.members.find((member) => member.id === memberId)?.name,
          dueDate,
        ]).filter(([name]) => name),
      ),
      status_by_member: Object.fromEntries(
        document.members
          .filter((member) => member.active && this._isAssigned(chore, member.id))
          .map((member) => {
            const nowDate = new Date(isoNow(this.now));
            const claim = this._claimFor(document, chore, member, nowDate);
            const dueDate = this._effectiveDueDate(chore, member.id);
            const overdue = dueDate && Date.parse(dueDate) <= nowDate.getTime();
            const neverOverdue = isNeverOverdue(chore.overdue_handling);
            return [member.name, {
              status: claim?.status || (overdue ? (neverOverdue ? 'due' : 'overdue') : 'pending'),
              claim_id: claim?.id || null,
              due_date: dueDate,
              last_completed: claim?.approved_at || null,
            }];
          }),
      ),
    }));
    const rewards = document.rewards.map((reward) => ({
      ...reward,
      assigned_user_names: this._memberNames(document, reward.assigned_member_ids),
    }));
    return {
      schema_version: document.schema_version,
      updated_at: document.updated_at,
      members,
      chores,
      chore_claims: document.chore_claims,
      rewards,
      reward_claims: document.reward_claims,
      bonuses: document.bonuses,
      penalties: document.penalties,
      badges: document.badges.map((badge) => ({ ...badge, assigned_user_names: this._memberNames(document, badge.assigned_member_ids || []) })),
      badge_awards: document.badge_awards,
      badge_progress: document.badge_progress,
      achievements: document.achievements,
      challenges: document.challenges,
      goal_progress: document.goal_progress,
      notifications: document.notifications,
      ui_controls: document.ui_controls,
      pending_approvals: {
        chores: document.chore_claims.filter((claim) => claim.status === 'claimed').length,
        rewards: document.reward_claims.filter((claim) => claim.status === 'pending').length,
      },
      points_by_user: Object.fromEntries(members.map((member) => [nameKey(member.name), member.points])),
      ledger: document.ledger,
    };
  }

  async createMember(data = {}) {
    return this._mutate((document) => {
      const name = normaliseName(data.name ?? data.user_name, 'name');
      if (document.members.some((member) => nameKey(member.name) === nameKey(name))) {
        throw new ChoresManStoreError('duplicate_user', `Family member already exists: ${name}`);
      }
      const role = data.role || 'child';
      if (!['parent', 'child'].includes(role)) {
        throw new ChoresManStoreError('invalid_data', 'role must be parent or child');
      }
      if (data.notification_preferences !== undefined && (!data.notification_preferences || typeof data.notification_preferences !== 'object' || Array.isArray(data.notification_preferences))) {
        throw new ChoresManStoreError('invalid_data', 'notification_preferences must be an object');
      }
      const member = {
        id: data.id || this.idFactory(),
        name,
        role,
        avatar: typeof data.avatar === 'string' && data.avatar ? data.avatar : role === 'parent' ? '🧑' : '🧒',
        color:
          typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color)
            ? data.color
            : MEMBER_COLORS[document.members.length % MEMBER_COLORS.length],
        active: true,
        paused: false,
        gamification_enabled: data.gamification_enabled !== false,
        notification_preferences: data.notification_preferences && typeof data.notification_preferences === 'object'
          ? clone(data.notification_preferences)
          : { enabled: true },
        created_at: isoNow(this.now),
        updated_at: isoNow(this.now),
      };
      document.members.push(member);
      return member;
    });
  }

  _rekeyMember(document, member, nextId) {
    if (member.id === nextId) return;
    if (document.members.some((candidate) => candidate !== member && candidate.id === nextId)) {
      throw new ChoresManStoreError('duplicate_user', `Family member id already exists: ${nextId}`);
    }
    const previousId = member.id;
    member.id = nextId;
    for (const chore of document.chores) {
      chore.assigned_member_ids = (chore.assigned_member_ids || []).map((id) => id === previousId ? nextId : id);
      for (const field of ['due_date_by_member', 'daily_multi_times_by_member', 'applicable_days_by_member', 'last_reset_key_by_member']) {
        if (!chore[field] || !Object.hasOwn(chore[field], previousId)) continue;
        chore[field][nextId] = chore[field][previousId];
        delete chore[field][previousId];
      }
      if (chore.rotation_state?.current_member_id === previousId) chore.rotation_state.current_member_id = nextId;
    }
    for (const collection of ['rewards', 'bonuses', 'penalties', 'badges', 'achievements', 'challenges']) {
      for (const item of document[collection]) {
        if (Array.isArray(item.assigned_member_ids)) {
          item.assigned_member_ids = item.assigned_member_ids.map((id) => id === previousId ? nextId : id);
        }
      }
    }
    for (const collection of ['chore_claims', 'reward_claims', 'ledger', 'chore_events', 'badge_awards', 'badge_progress', 'goal_progress', 'notifications', 'ui_controls']) {
      for (const entry of document[collection]) {
        if (entry.member_id === previousId) entry.member_id = nextId;
        if (entry.user_id === previousId) entry.user_id = nextId;
      }
    }
  }

  async syncMembers(data = {}) {
    if (!Array.isArray(data.members)) {
      throw new ChoresManStoreError('invalid_data', 'members must be an array');
    }
    return this._mutate((document) => {
      const activeFamilyIds = new Set();
      const synced = [];
      for (const profile of data.members) {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
          throw new ChoresManStoreError('invalid_data', 'each family member must be an object');
        }
        const familyMemberId = normaliseName(profile.id, 'family member id');
        const name = normaliseName(profile.name, 'name');
        const role = profile.role || 'child';
        if (!['parent', 'child'].includes(role)) {
          throw new ChoresManStoreError('invalid_data', 'role must be parent or child');
        }
        activeFamilyIds.add(familyMemberId);
        let member = document.members.find((candidate) => candidate.family_member_id === familyMemberId) ||
          document.members.find((candidate) => candidate.id === familyMemberId) ||
          document.members.find((candidate) => nameKey(candidate.name) === nameKey(name));
        if (member) {
          if (document.members.some((candidate) => candidate.id !== member.id && candidate.active && nameKey(candidate.name) === nameKey(name))) {
            throw new ChoresManStoreError('duplicate_user', `Family member already exists: ${name}`);
          }
          this._rekeyMember(document, member, familyMemberId);
          member.name = name;
          member.role = role;
          member.active = true;
          member.family_member_id = familyMemberId;
          if (typeof profile.avatar === 'string' && profile.avatar) member.avatar = profile.avatar;
          if (typeof profile.color === 'string' && /^#[0-9a-f]{6}$/i.test(profile.color)) member.color = profile.color;
          member.updated_at = isoNow(this.now);
        } else {
          member = {
            id: familyMemberId,
            family_member_id: familyMemberId,
            name,
            role,
            avatar: typeof profile.avatar === 'string' && profile.avatar ? profile.avatar : role === 'parent' ? '🧑' : '🧒',
            color: typeof profile.color === 'string' && /^#[0-9a-f]{6}$/i.test(profile.color)
              ? profile.color
              : MEMBER_COLORS[document.members.length % MEMBER_COLORS.length],
            active: true,
            paused: false,
            gamification_enabled: true,
            notification_preferences: { enabled: true },
            created_at: isoNow(this.now),
            updated_at: isoNow(this.now),
          };
          document.members.push(member);
        }
        synced.push(member.id);
      }
      for (const member of document.members) {
        if (!member.family_member_id || activeFamilyIds.has(member.family_member_id) || !member.active) continue;
        member.active = false;
        member.paused = false;
        member.updated_at = isoNow(this.now);
        for (const chore of document.chores) {
          chore.assigned_member_ids = chore.assigned_member_ids.filter((id) => id !== member.id);
          if (chore.rotation_state?.current_member_id === member.id) {
            chore.rotation_state.current_member_id = this._rotationMembers(document, chore)[0] || null;
          }
        }
        for (const claim of document.chore_claims) {
          if (claim.member_id === member.id && ['in_progress', 'claimed'].includes(claim.status)) claim.status = 'cancelled';
        }
        for (const claim of document.reward_claims) {
          if (claim.member_id === member.id && claim.status === 'pending') claim.status = 'cancelled';
        }
      }
      return { synced_member_ids: synced, count: synced.length };
    });
  }

  async updateMember(data = {}) {
    return this._mutate((document) => {
      const member = this._findMember(document, data, { active: false });
      if (Object.hasOwn(data, 'name') || Object.hasOwn(data, 'user_name')) {
        const name = normaliseName(data.name ?? data.user_name, 'name');
        if (document.members.some((candidate) => candidate.id !== member.id && nameKey(candidate.name) === nameKey(name))) {
          throw new ChoresManStoreError('duplicate_user', `Family member already exists: ${name}`);
        }
        member.name = name;
      }
      if (Object.hasOwn(data, 'role')) {
        if (!['parent', 'child'].includes(data.role)) {
          throw new ChoresManStoreError('invalid_data', 'role must be parent or child');
        }
        member.role = data.role;
      }
      if (Object.hasOwn(data, 'avatar')) member.avatar = String(data.avatar || '');
      if (Object.hasOwn(data, 'color')) {
        if (typeof data.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(data.color)) {
          throw new ChoresManStoreError('invalid_data', 'color must be a six-digit hex color');
        }
        member.color = data.color;
      }
      if (Object.hasOwn(data, 'active')) member.active = Boolean(data.active);
      if (Object.hasOwn(data, 'gamification_enabled')) member.gamification_enabled = Boolean(data.gamification_enabled);
      if (Object.hasOwn(data, 'notification_preferences')) {
        if (!data.notification_preferences || typeof data.notification_preferences !== 'object' || Array.isArray(data.notification_preferences)) {
          throw new ChoresManStoreError('invalid_data', 'notification_preferences must be an object');
        }
        member.notification_preferences = clone(data.notification_preferences);
      }
      member.updated_at = isoNow(this.now);
      return member;
    });
  }

  async deleteMember(data = {}) {
    return this._mutate((document) => {
      const member = this._findMember(document, data, { active: false });
      member.active = false;
      member.paused = false;
      member.updated_at = isoNow(this.now);
      for (const chore of document.chores) {
        chore.assigned_member_ids = chore.assigned_member_ids.filter((id) => id !== member.id);
        if (chore.rotation_state?.current_member_id === member.id) chore.rotation_state.current_member_id = this._rotationMembers(document, chore)[0] || null;
      }
      for (const claim of document.chore_claims) {
        if (claim.member_id === member.id && ['in_progress', 'claimed'].includes(claim.status)) claim.status = 'cancelled';
      }
      for (const claim of document.reward_claims) {
        if (claim.member_id === member.id && claim.status === 'pending') claim.status = 'cancelled';
      }
      this._event(document, { type: 'member_archived', member_id: member.id, user_name: member.name });
      return { user_id: member.id, user_name: member.name, deleted: true };
    });
  }

  async _createChore(document, data) {
    const name = normaliseName(data.name, 'name');
    if (document.chores.some((chore) => nameKey(chore.name) === nameKey(name))) {
      throw new ChoresManStoreError('duplicate_chore', `Chore already exists: ${name}`);
    }
    if (!Object.hasOwn(data, 'assigned_user_names')) {
      throw new ChoresManStoreError('invalid_data', 'assigned_user_names is required');
    }
    const assignedIds = this._resolveAssignees(document, data.assigned_user_names, { allowEmpty: false });
    const chore = {
      id: this.idFactory(),
      name,
      assigned_member_ids: assignedIds,
      points: 0,
      description: '',
      labels: [],
      frequency: 'none',
      completion_criteria: 'independent',
      auto_approve: false,
      due_date: null,
      due_date_by_member: {},
      daily_multi_times: [],
      daily_multi_times_by_member: {},
      applicable_days_by_member: {},
      rotation_state: { current_member_id: assignedIds[0] === ASSIGN_ALL ? null : assignedIds[0], open: false },
      last_reset_key_by_member: {},
      notify_on_claim: true,
      notify_on_approval: true,
      notify_on_disapproval: true,
      notify_on_overdue: true,
      notify_on_due_window: false,
      notify_due_reminder: true,
      approval_reset_type: 'upon_completion',
      pending_claims: 'hold_pending',
      created_at: isoNow(this.now),
      updated_at: isoNow(this.now),
    };
    this._applyChoreFields(document, chore, data, { create: true });
    this._initializeDueDates(document, chore);
    document.chores.push(chore);
    return { chore_id: chore.id, id: chore.id, name: chore.name };
  }

  _applyChoreFields(document, chore, data, { create = false } = {}) {
    if (Object.hasOwn(data, 'completion_criteria')) {
      if (!create) {
        throw new ChoresManStoreError(
          'immutable_field',
          'completion_criteria can only be set when a chore is created',
        );
      }
      if (!COMPLETION_CRITERIA.has(data.completion_criteria)) {
        throw new ChoresManStoreError('invalid_data', 'completion_criteria is not supported');
      }
      chore.completion_criteria = data.completion_criteria;
    }
    for (const field of CHORE_FIELDS) {
      if (!Object.hasOwn(data, field)) continue;
      const value = data[field];
      if (field === 'points') chore.points = finiteNumber(value, field, { min: 0 });
      else if (field === 'custom_interval') chore.custom_interval = Math.max(1, Math.round(finiteNumber(value, field, { min: 1 })));
      else if (field === 'custom_interval_unit') {
        if (!INTERVAL_UNITS.has(value)) throw new ChoresManStoreError('invalid_data', 'custom_interval_unit is invalid');
        chore.custom_interval_unit = value;
      } else if (field === 'frequency') {
        if (!FREQUENCIES.has(value)) throw new ChoresManStoreError('invalid_data', 'frequency is invalid');
        chore.frequency = value;
      } else if (field === 'applicable_days' || field === 'labels') {
        const values = stringList(value, field).map((item) => item.toLowerCase());
        if (field === 'applicable_days' && values.some((day) => !Object.hasOwn(WEEKDAY_INDEX, day))) {
          throw new ChoresManStoreError(
            'invalid_data',
            'applicable_days must contain weekday keys such as mon or wed',
          );
        }
        chore[field] = values;
      } else if (field === 'daily_multi_times') {
        chore.daily_multi_times = normaliseTimes(value, field);
      } else if (field === 'daily_multi_times_by_member' || field === 'applicable_days_by_member') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new ChoresManStoreError('invalid_data', `${field} must map member names to arrays`);
        }
        const memberMap = {};
        for (const [userName, entries] of Object.entries(value)) {
          const member = this._findMember(document, { user_name: userName });
          const list = field === 'daily_multi_times_by_member'
            ? normaliseTimes(entries, field)
            : stringList(entries, field).map((item) => item.toLowerCase());
          if (field === 'applicable_days_by_member' && list.some((day) => !Object.hasOwn(WEEKDAY_INDEX, day))) {
            throw new ChoresManStoreError('invalid_data', 'applicable_days_by_member must use weekday keys such as mon or wed');
          }
          memberMap[member.id] = list;
        }
        chore[field] = memberMap;
      } else if (field === 'due_date') {
        chore.due_date = parseDate(value, field)?.toISOString() ?? null;
      } else if (
        [
          'auto_approve',
          'chore_claim_lock_until_window',
          'notify_on_claim',
          'notify_on_approval',
          'notify_on_disapproval',
          'notify_on_overdue',
          'notify_on_due_window',
          'notify_due_reminder',
          'allow_steal',
          'show_on_calendar',
        ].includes(field)
      ) {
        if (typeof value !== 'boolean') throw new ChoresManStoreError('invalid_data', `${field} must be boolean`);
        chore[field] = value;
      } else if (field === 'standby_claim_mode') {
        if (!['anytime', 'on_overdue', 'manual_only'].includes(value)) {
          throw new ChoresManStoreError('invalid_data', 'standby_claim_mode must be anytime, on_overdue, or manual_only');
        }
        chore[field] = value;
      } else if (field === 'notification_importance') {
        if (!['min', 'low', 'default', 'high', 'max'].includes(String(value))) {
          throw new ChoresManStoreError('invalid_data', 'notification_importance must be min, low, default, high, or max');
        }
        chore[field] = value;
      } else if (field === 'notification_priority') {
        if (!['normal', 'high'].includes(String(value))) {
          throw new ChoresManStoreError('invalid_data', 'notification_priority must be normal or high');
        }
        chore[field] = value;
      } else if (field === 'notification_ttl') {
        if (!Number.isInteger(Number(value))) {
          throw new ChoresManStoreError('invalid_data', 'notification_ttl must be an integer number of seconds');
        }
        chore[field] = finiteNumber(value, field, { min: 0, max: MAX_NOTIFICATION_TTL_SECONDS, decimals: 0 });
      } else if (field === 'approval_reset_type') {
        if (!APPROVAL_RESET_TYPES.has(value)) throw new ChoresManStoreError('invalid_data', 'approval_reset_type is invalid');
        chore[field] = value;
      } else if (field === 'pending_claims') {
        if (!PENDING_CLAIM_ACTIONS.has(value)) throw new ChoresManStoreError('invalid_data', 'pending_claims is invalid');
        chore[field] = value;
      } else if (value === null) {
        chore[field] = null;
      } else {
        if (field === 'due_window_offset' || field === 'due_reminder_offset') {
          durationMilliseconds(value, field);
        }
        chore[field] = typeof value === 'string' ? value.trim() : value;
      }
    }
    if (Object.hasOwn(data, 'overdue_handling') && !Object.hasOwn(data, 'allow_steal')) {
      chore.allow_steal = /steal/i.test(String(data.overdue_handling));
    }
    if (isNeverOverdue(chore.overdue_handling) &&
      !['rotation_simple', 'rotation_simple_from_turn_holder'].includes(chore.completion_criteria)) {
      throw new ChoresManStoreError(
        'invalid_data',
        'never_overdue requires rotation_simple or rotation_simple_from_turn_holder completion criteria',
      );
    }
    chore.updated_at = isoNow(this.now);
  }

  async _updateChore(document, data) {
    const chore = this._findChore(document, data);
    const originalAssignees = [...chore.assigned_member_ids];
    const hasId = Boolean(data.id || data.chore_id);
    if (Object.hasOwn(data, 'name') && hasId) {
      const name = normaliseName(data.name, 'name');
      if (document.chores.some((candidate) => candidate.id !== chore.id && nameKey(candidate.name) === nameKey(name))) {
        throw new ChoresManStoreError('duplicate_chore', `Chore already exists: ${name}`);
      }
      chore.name = name;
    }
    if (Object.hasOwn(data, 'assigned_user_names')) {
      const mode = data.assignment_action || 'replace';
      const requested = this._resolveAssignees(document, data.assigned_user_names, { allowEmpty: true });
      if (mode === 'replace') chore.assigned_member_ids = requested;
      else if (mode === 'add') {
        chore.assigned_member_ids = requested.includes(ASSIGN_ALL) || chore.assigned_member_ids.includes(ASSIGN_ALL)
          ? [ASSIGN_ALL]
          : [...new Set([...chore.assigned_member_ids, ...requested])];
      } else if (mode === 'remove') {
        chore.assigned_member_ids = chore.assigned_member_ids.includes(ASSIGN_ALL)
          ? document.members.filter((member) => member.active && !requested.includes(member.id)).map((member) => member.id)
          : chore.assigned_member_ids.filter((id) => !requested.includes(id));
      } else {
        throw new ChoresManStoreError('invalid_data', 'assignment_action must be replace, add, or remove');
      }
      if (ROTATION_CRITERIA.has(chore.completion_criteria)) {
        const activeIds = this._rotationMembers(document, chore);
        if (!activeIds.includes(chore.rotation_state?.current_member_id)) {
          chore.rotation_state = { current_member_id: activeIds[0] || null, open: false };
        }
      }
    }
    this._applyChoreFields(document, chore, data);
    if (Object.hasOwn(data, 'assigned_user_names')) {
      const activeIds = this._rotationMembers(document, chore);
      chore.due_date_by_member = Object.fromEntries(Object.entries(chore.due_date_by_member || {}).filter(([id]) => activeIds.includes(id)));
      const added = activeIds.filter((id) => !originalAssignees.includes(id));
      if (added.length) this._initializeDueDates(document, chore, added);
    }
    return { chore_id: chore.id, id: chore.id, name: chore.name };
  }

  _initializeDueDates(document, chore, onlyMemberIds = null) {
    if (chore.completion_criteria !== 'independent' || ['none', 'daily'].includes(chore.frequency || 'none')) return;
    if (chore.due_date) return;
    const ids = (onlyMemberIds || this._rotationMembers(document, chore)).filter((id) => !chore.due_date_by_member?.[id]);
    for (const memberId of ids) {
      const next = nextDueDate(chore, isoNow(this.now), memberId);
      if (!next) continue;
      if (ids.length > 1 || chore.assigned_member_ids.includes(ASSIGN_ALL) || chore.due_date_by_member && Object.keys(chore.due_date_by_member).length > 0) {
        chore.due_date_by_member ||= {};
        chore.due_date_by_member[memberId] = next;
      } else chore.due_date = next;
    }
  }

  async _deleteChore(document, data) {
    const chore = this._findChore(document, data);
    for (const claim of document.chore_claims.filter((entry) => entry.chore_id === chore.id)) this._clearNotifications(document, claim.id);
    this._clearNotifications(document, chore.id);
    document.chores = document.chores.filter((candidate) => candidate.id !== chore.id);
    document.chore_claims = document.chore_claims.filter((claim) => claim.chore_id !== chore.id);
    this._event(document, { type: 'chore_deleted', chore_id: chore.id, chore_name: chore.name });
    return { chore_id: chore.id, deleted: true };
  }

  async _claimChore(document, data, { takeOnly = false } = {}) {
    const chore = this._findChore(document, data);
    const member = this._findMember(document, data);
    if (takeOnly && chore.completion_criteria !== 'shared_first') {
      throw new ChoresManStoreError('invalid_data', 'Only a shared-first chore can be taken before completion');
    }
    const claimTime = this.now();
    if (member.paused && member.paused_until && Date.parse(member.paused_until) <= Date.parse(claimTime)) {
      await this._pauseUserChores(document, { user_id: member.id, paused: false });
    }
    if (member.paused) throw new ChoresManStoreError('user_paused', `${member.name}'s chores are paused`);
    if (!this._isAssigned(chore, member.id)) {
      throw new ChoresManStoreError('user_not_assigned', `${member.name} is not assigned to ${chore.name}`);
    }
    const nowDate = this.now();
    const dueDate = this._effectiveDueDate(chore, member.id);
    const resetMode = chore.approval_reset_type || 'upon_completion';
    if (['at_midnight_once', 'at_midnight_multi'].includes(resetMode) && dueDate && Date.parse(nowDate) < Date.parse(dueDate)) {
      throw new ChoresManStoreError('chore_not_due', `${chore.name} is not available until its due boundary`);
    }
    if (chore.chore_claim_lock_until_window && dueDate && Date.parse(nowDate) < Date.parse(dueDate)) {
      const windowOffset = durationMilliseconds(chore.due_window_offset, 'due_window_offset');
      const opensAt = Date.parse(dueDate) - windowOffset;
      if (windowOffset > 0 && Date.parse(nowDate) < opensAt) {
        throw new ChoresManStoreError('claim_window_closed', 'This chore is locked until its due window opens');
      }
    }
    const occurrence = cycleKey(chore, member.id, nowDate);
    const resetType = chore.approval_reset_type || 'upon_completion';
    const earlierApproval = document.chore_claims.find((claim) => claim.chore_id === chore.id && claim.member_id === member.id && claim.status === 'approved');
    if (resetType === 'manual_reset_only' && earlierApproval) {
      throw new ChoresManStoreError('chore_already_claimed', `${chore.name} requires a manual reset before it can be claimed again`);
    }
    if (resetType === 'at_due_date' && dueDate && Date.parse(dueDate) <= Date.parse(nowDate) && document.chore_claims.some((claim) => claim.chore_id === chore.id && claim.member_id === member.id && claim.status === 'approved' && claim.due_date_at_claim === dueDate)) {
      throw new ChoresManStoreError('chore_already_claimed', `${chore.name} is waiting for its due-date reset`);
    }
    let rotationStolen = false;
    if (ROTATION_CRITERIA.has(chore.completion_criteria)) {
      const competingClaim = document.chore_claims.find((claim) => claim.chore_id === chore.id && claim.occurrence === occurrence && ['in_progress', 'claimed', 'approved'].includes(claim.status));
      if (competingClaim && competingClaim.member_id !== member.id) {
        throw new ChoresManStoreError('chore_already_claimed', `${chore.name} is already claimed for this rotation`);
      }
      const turn = this._rotationTurn(document, chore);
      const members = this._rotationMembers(document, chore);
      const primary = members[0];
      const isPrimaryStandby = chore.completion_criteria === 'primary_standby';
      if (isPrimaryStandby && member.id !== primary && !chore.rotation_state?.open) {
        const mode = chore.standby_claim_mode || 'manual_only';
        const due = this._effectiveDueDate(chore, member.id);
        const overdue = due && Date.parse(nowDate) >= Date.parse(due);
        if (mode === 'manual_only' || (mode === 'on_overdue' && !overdue)) {
          throw new ChoresManStoreError('not_my_turn', `${member.name} is on standby for ${chore.name}`);
        }
      } else if (!isPrimaryStandby && turn !== member.id && !chore.rotation_state?.open) {
        const due = this._effectiveDueDate(chore, member.id);
        const canSteal = chore.allow_steal === true && due && Date.parse(nowDate) >= Date.parse(due);
        if (!canSteal) throw new ChoresManStoreError('not_my_turn', `${member.name} does not have the current turn for ${chore.name}`);
        rotationStolen = true;
      }
    }
    if (chore.completion_criteria === 'shared_first') {
      const otherClaim = document.chore_claims.find(
        (claim) => claim.chore_id === chore.id && claim.occurrence === occurrence && claim.member_id !== member.id && ['in_progress', 'claimed', 'approved'].includes(claim.status),
      );
      if (otherClaim) throw new ChoresManStoreError('chore_already_claimed', `${chore.name} is already claimed`);
    }
    let claim = this._claimFor(document, chore, member, nowDate);
    if (claim && (['claimed', 'approved'].includes(claim.status) || (takeOnly && claim.status === 'in_progress'))) {
      throw new ChoresManStoreError('chore_already_claimed', `${chore.name} is already claimed for this period`);
    }
    const timestamp = isoNow(this.now);
    if (!takeOnly) this._clearNotifications(document, chore.id);
    if (!claim) {
      claim = {
        id: this.idFactory(),
        chore_id: chore.id,
        chore_name: chore.name,
        member_id: member.id,
        user_name: member.name,
        occurrence,
        status: takeOnly ? 'in_progress' : 'claimed',
        claimed_at: timestamp,
        ...(takeOnly ? { started_at: timestamp } : { completed_at: timestamp }),
        due_date_at_claim: dueDate,
        ...(rotationStolen ? { rotation_stolen: true } : {}),
      };
      document.chore_claims.push(claim);
    } else {
      const wasInProgress = claim.status === 'in_progress';
      claim.status = takeOnly ? 'in_progress' : 'claimed';
      if (takeOnly) {
        claim.started_at = timestamp;
        delete claim.completed_at;
      }
      else {
        if (!wasInProgress) claim.claimed_at = timestamp;
        claim.completed_at = timestamp;
      }
      claim.approved_at = null;
      claim.disapproved_at = null;
      claim.approver_name = null;
      claim.due_date_at_claim = dueDate;
      if (rotationStolen) claim.rotation_stolen = true;
    }
    this._event(document, { type: takeOnly ? 'chore_taken' : 'chore_claimed', chore_id: chore.id, member_id: member.id, user_name: member.name, claim_id: claim.id });
    if (!takeOnly && chore.notify_on_claim !== false) {
      this._queueForParents(document, {
        type: 'chore_claimed', title: `${member.name} claimed ${chore.name}`,
        message: `${member.name} is waiting for approval.`, referenceId: claim.id, action: 'approve_chore',
      });
    }
    if (!takeOnly && chore.auto_approve) {
      this._automaticallyApproveClaim(document, chore, member, claim);
    }
    return { chore_id: chore.id, claim_id: claim.id, status: claim.status };
  }

  async _approveChore(document, data) {
    const chore = this._findChore(document, data);
    const member = this._findMember(document, data);
    const approverName = normaliseName(data.approver_name, 'approver_name');
    const claim = this._claimFor(document, chore, member, this.now());
    if (!claim || claim.status !== 'claimed') {
      throw new ChoresManStoreError('claim_not_pending', `No pending claim for ${member.name} on ${chore.name}`);
    }
    const basePoints = Object.hasOwn(data, 'points_awarded')
      ? finiteNumber(data.points_awarded, 'points_awarded', { min: 0 })
      : chore.points;
    claim.status = 'approved';
    claim.approved_at = isoNow(this.now);
    claim.approver_name = approverName;
    const award = this._awardPoints(document, member, basePoints, {
      source: 'chore',
      sourceLabel: 'Chore completion',
      itemName: chore.name,
      referenceId: claim.id,
      approverName,
      multiplier: true,
    });
    const points = award.points_awarded;
    claim.points_awarded = points;
    this._event(document, { type: 'chore_approved', chore_id: chore.id, member_id: member.id, user_name: member.name, claim_id: claim.id, approver_name: approverName, points_awarded: points });
    this._evaluateGoals(document, { member, chore, points, timestamp: claim.approved_at, claimId: claim.id });
    this._advanceRotation(document, chore, member.id);
    const resetType = chore.approval_reset_type || 'upon_completion';
    if (resetType === 'upon_completion' || (resetType === 'at_due_date' && claim.due_date_at_claim && Date.parse(claim.due_date_at_claim) <= Date.parse(claim.approved_at))) {
      this._advanceChoreDate(document, chore, member.id, claim.approved_at);
    }
    this._clearNotifications(document, claim.id);
    if (chore.notify_on_approval !== false) this._queueNotification(document, member, {
      type: 'chore_approved', title: `${chore.name} approved`, message: `You earned ${points} points.`, referenceId: claim.id,
    });
    return { chore_id: chore.id, claim_id: claim.id, points_awarded: points, status: claim.status };
  }

  async _disapproveChore(document, data) {
    const chore = this._findChore(document, data);
    const member = this._findMember(document, data);
    const approverName = normaliseName(data.approver_name, 'approver_name');
    const claim = this._claimFor(document, chore, member, this.now());
    if (!claim || claim.status !== 'claimed') {
      throw new ChoresManStoreError('claim_not_pending', `No pending claim for ${member.name} on ${chore.name}`);
    }
    claim.status = 'disapproved';
    claim.disapproved_at = isoNow(this.now);
    claim.approver_name = approverName;
    this._event(document, { type: 'chore_disapproved', chore_id: chore.id, member_id: member.id, user_name: member.name, claim_id: claim.id, approver_name: approverName });
    this._clearNotifications(document, claim.id);
    if (chore.notify_on_disapproval !== false) this._queueNotification(document, member, {
      type: 'chore_disapproved', title: `${chore.name} needs more work`, message: `Your completion was returned by ${approverName}.`, referenceId: claim.id,
    });
    return { chore_id: chore.id, claim_id: claim.id, status: claim.status };
  }

  _advanceChoreDate(document, chore, memberId, completedAt, { advancePastCompletion = false } = {}) {
    if (['none', undefined, null].includes(chore.frequency || 'none')) return;
    const scheduled = chore.due_date_by_member?.[memberId] || chore.due_date;
    const fromCompletion = ['custom_from_complete', 'custom_from_complete_date_only'].includes(chore.frequency);
    let next = nextDueDate(chore, fromCompletion ? completedAt : scheduled || completedAt, memberId);
    // Keep the chore's scheduled time while advancing stale dates past the
    // completion. This also handles a chore that was several occurrences late.
    for (let count = 0; next && (advancePastCompletion || chore.frequency !== 'daily_multi') && !fromCompletion && Date.parse(next) <= Date.parse(completedAt) && count < 100; count += 1) {
      next = nextDueDate(chore, next, memberId);
    }
    if (!next) return;
    if (chore.due_date_by_member?.[memberId] || (chore.completion_criteria === 'independent' && this._rotationMembers(document, chore).length > 1)) {
      chore.due_date_by_member ||= {};
      chore.due_date_by_member[memberId] = next;
    }
    else chore.due_date = next;
    chore.updated_at = isoNow(this.now);
  }

  async _setChoreDueDate(document, data) {
    const chore = this._findChore(document, data);
    const dueDate = parseDate(data.due_date, 'due_date')?.toISOString() ?? null;
    let scopedMember = null;
    if (data.user_name || data.user_id) {
      scopedMember = this._findMember(document, data);
      chore.due_date_by_member ||= {};
      if (dueDate) chore.due_date_by_member[scopedMember.id] = dueDate;
      else delete chore.due_date_by_member[scopedMember.id];
    } else {
      chore.due_date = dueDate;
      chore.due_date_by_member = {};
    }
    for (const claim of document.chore_claims) {
      if (
        claim.chore_id === chore.id &&
        (!scopedMember || claim.member_id === scopedMember.id) &&
        ['in_progress', 'claimed', 'approved'].includes(claim.status)
      ) {
        claim.status = 'reset';
        claim.reset_at = isoNow(this.now);
      }
    }
    chore.updated_at = isoNow(this.now);
    this._clearNotifications(document, chore.id);
    this._event(document, { type: 'chore_due_date_set', chore_id: chore.id, chore_name: chore.name, due_date: dueDate, ...(data.user_name ? { user_name: data.user_name } : {}) });
    return { chore_id: chore.id, due_date: dueDate };
  }

  async _skipChoreDueDate(document, data) {
    const chore = this._findChore(document, data);
    const member = data.user_name || data.user_id ? this._findMember(document, data) : null;
    const target = member?.id || null;
    const current = target
      ? chore.due_date_by_member?.[target] || chore.due_date
      : chore.due_date;
    const now = isoNow(this.now);
    let next = nextDueDate(chore, current || now, target);
    for (let count = 0; next && Date.parse(next) <= Date.parse(now) && count < 100; count += 1) {
      next = nextDueDate(chore, next, target);
    }
    if (next) {
      if (target) {
        chore.due_date_by_member ||= {};
        chore.due_date_by_member[target] = next;
      } else chore.due_date = next;
    }
    chore.updated_at = isoNow(this.now);
    this._clearNotifications(document, chore.id);
    this._event(document, {
      type: data.mark_as_missed ? 'chore_missed' : 'chore_due_date_skipped',
      chore_id: chore.id,
      chore_name: chore.name,
      ...(member ? { member_id: member.id, user_name: member.name } : {}),
      next_due_date: next,
    });
    if (data.mark_as_missed === true) {
      if (target) this._advanceRotation(document, chore, target);
      else this._advanceRotation(document, chore, this._rotationTurn(document, chore));
    }
    return { chore_id: chore.id, next_due_date: next, mark_as_missed: data.mark_as_missed === true };
  }

  async _pauseUserChores(document, data) {
    const member = this._findMember(document, data);
    if (Object.hasOwn(data, 'paused') && typeof data.paused !== 'boolean') throw new ChoresManStoreError('invalid_data', 'paused must be boolean');
    const paused = data.paused !== false;
    const actions = ['unpause', 'unpause_shift_independent', 'unpause_shift_all_primary', 'unpause_shift_all'];
    const requestedAction = data.unpause_action;
    if (requestedAction && !actions.includes(requestedAction)) {
      throw new ChoresManStoreError('invalid_data', 'unpause_action is invalid');
    }
    if (!paused) {
      const action = requestedAction || member.unpause_action || 'unpause';
      if (action !== 'unpause') this._shiftMemberChores(document, member, action, this.now());
      member.paused = false;
      member.paused_until = null;
      member.paused_at = null;
      member.unpause_action = null;
      member.updated_at = isoNow(this.now);
      this._event(document, { type: 'chores_unpaused', member_id: member.id, user_name: member.name, unpause_action: action });
      return { user_id: member.id, user_name: member.name, paused: false, paused_until: null, unpause_action: action };
    }
    member.paused = paused;
    member.paused_until = paused ? parseDate(data.paused_until, 'paused_until')?.toISOString() ?? null : null;
    member.paused_at = isoNow(this.now);
    member.unpause_action = requestedAction || null;
    member.updated_at = isoNow(this.now);
    this._event(document, { type: paused ? 'chores_paused' : 'chores_unpaused', member_id: member.id, user_name: member.name, paused_until: member.paused_until });
    return { user_id: member.id, user_name: member.name, paused, paused_until: member.paused_until };
  }

  async _createReward(document, data) {
    const name = normaliseName(data.name, 'name');
    if (document.rewards.some((reward) => nameKey(reward.name) === nameKey(name))) {
      throw new ChoresManStoreError('duplicate_reward', `Reward already exists: ${name}`);
    }
    const cost = finiteNumber(data.cost, 'cost', { min: 0 });
    const assignedIds = Object.hasOwn(data, 'assigned_user_names')
      ? this._resolveAssignees(document, data.assigned_user_names)
      : [ASSIGN_ALL];
    const reward = {
      id: this.idFactory(),
      name,
      assigned_member_ids: assignedIds,
      cost,
      description: '',
      labels: [],
      created_at: isoNow(this.now),
      updated_at: isoNow(this.now),
      approved: data.approved !== false,
    };
    this._applyRewardFields(reward, data, { create: true });
    document.rewards.push(reward);
    return { reward_id: reward.id, id: reward.id, name: reward.name };
  }

  _applyRewardFields(reward, data, { create = false } = {}) {
    for (const field of REWARD_FIELDS) {
      if (!Object.hasOwn(data, field) || (create && field === 'cost')) continue;
      if (field === 'cost') reward.cost = finiteNumber(data.cost, 'cost', { min: 0 });
      else if (field === 'labels') reward.labels = stringList(data.labels, 'labels').map((item) => item.toLowerCase());
      else reward[field] = data[field] === null ? '' : String(data[field]).trim();
    }
    reward.updated_at = isoNow(this.now);
  }

  async _updateReward(document, data) {
    const reward = this._findReward(document, data);
    if (Object.hasOwn(data, 'name') && (data.id || data.reward_id)) {
      const name = normaliseName(data.name, 'name');
      if (document.rewards.some((candidate) => candidate.id !== reward.id && nameKey(candidate.name) === nameKey(name))) {
        throw new ChoresManStoreError('duplicate_reward', `Reward already exists: ${name}`);
      }
      reward.name = name;
    }
    if (Object.hasOwn(data, 'assigned_user_names')) {
      reward.assigned_member_ids = this._resolveAssignees(document, data.assigned_user_names, { allowEmpty: true });
    }
    this._applyRewardFields(reward, data);
    return { reward_id: reward.id, id: reward.id, name: reward.name };
  }

  async _approveRewardDefinition(document, data) {
    const reward = this._findReward(document, data);
    const approverName = normaliseName(data.approver_name, 'approver_name');
    if (reward.approved !== true) {
      reward.approved = true;
      reward.approved_at = isoNow(this.now);
      reward.approved_by = approverName;
      reward.updated_at = isoNow(this.now);
      this._event(document, {
        type: 'reward_definition_approved',
        reward_id: reward.id,
        reward_name: reward.name,
        approver_name: approverName,
      });
    }
    return { reward_id: reward.id, approved: true };
  }

  async _deleteReward(document, data) {
    const reward = this._findReward(document, data);
    for (const claim of document.reward_claims.filter((entry) => entry.reward_id === reward.id)) this._clearNotifications(document, claim.id);
    document.rewards = document.rewards.filter((candidate) => candidate.id !== reward.id);
    document.reward_claims = document.reward_claims.filter((claim) => claim.reward_id !== reward.id);
    this._event(document, { type: 'reward_deleted', reward_id: reward.id, reward_name: reward.name });
    return { reward_id: reward.id, deleted: true };
  }

  _pendingReward(document, reward, member) {
    return document.reward_claims.find(
      (claim) => claim.reward_id === reward.id && claim.member_id === member.id && claim.status === 'pending',
    );
  }

  _reservedPoints(document, memberId) {
    return document.reward_claims
      .filter((claim) => claim.member_id === memberId && claim.status === 'pending')
      .reduce((total, claim) => total + claim.cost, 0);
  }

  async _redeemReward(document, data) {
    const reward = this._findReward(document, data);
    if (reward.approved === false) {
      throw new ChoresManStoreError('reward_not_approved', `${reward.name} is waiting for parent approval`);
    }
    const member = this._findMember(document, data);
    const approverName = normaliseName(data.approver_name, 'approver_name');
    if (this._pendingReward(document, reward, member)) {
      throw new ChoresManStoreError('reward_already_pending', `${reward.name} is already awaiting approval`);
    }
    const spendable = this._balance(document, member.id) - this._reservedPoints(document, member.id);
    if (spendable < reward.cost) {
      throw new ChoresManStoreError('insufficient_points', `${member.name} does not have enough points`);
    }
    const claim = {
      id: this.idFactory(),
      reward_id: reward.id,
      reward_name: reward.name,
      member_id: member.id,
      user_name: member.name,
      approver_name: approverName,
      cost: reward.cost,
      status: 'pending',
      requested_at: isoNow(this.now),
    };
    document.reward_claims.push(claim);
    this._event(document, { type: 'reward_requested', reward_id: reward.id, member_id: member.id, user_name: member.name, claim_id: claim.id });
    this._queueForParents(document, {
      type: 'reward_requested', title: `${member.name} requested ${reward.name}`,
      message: `${reward.name} is waiting for approval.`, referenceId: claim.id, action: 'approve_reward',
    });
    return { reward_id: reward.id, claim_id: claim.id, status: claim.status };
  }

  async _approveReward(document, data) {
    const reward = this._findReward(document, data);
    if (reward.approved === false) {
      throw new ChoresManStoreError('reward_not_approved', `${reward.name} is waiting for parent approval`);
    }
    const member = this._findMember(document, data);
    const approverName = normaliseName(data.approver_name, 'approver_name');
    const pending = this._pendingReward(document, reward, member);
    const cost = Object.hasOwn(data, 'cost_override')
      ? finiteNumber(data.cost_override, 'cost_override', { min: 0 })
      : pending?.cost ?? reward.cost;
    if (this._balance(document, member.id) - (pending ? this._reservedPoints(document, member.id) - pending.cost : this._reservedPoints(document, member.id)) < cost) {
      throw new ChoresManStoreError('insufficient_points', `${member.name} does not have enough points`);
    }
    const transactionId = pending?.id || this.idFactory();
    if (pending) {
      pending.status = 'approved';
      pending.approved_at = isoNow(this.now);
      pending.approver_name = approverName;
      pending.cost = cost;
    } else {
      document.reward_claims.push({
        id: transactionId,
        reward_id: reward.id,
        reward_name: reward.name,
        member_id: member.id,
        user_name: member.name,
        approver_name: approverName,
        cost,
        status: 'approved',
        requested_at: isoNow(this.now),
        approved_at: isoNow(this.now),
        manual: true,
      });
    }
    this._appendLedger(document, member, -cost, {
      source: 'reward',
      sourceLabel: 'Reward redemption',
      itemName: reward.name,
      referenceId: transactionId,
      approverName,
    });
    this._event(document, { type: 'reward_approved', reward_id: reward.id, member_id: member.id, user_name: member.name, claim_id: transactionId, approver_name: approverName, cost });
    this._clearNotifications(document, transactionId);
    this._queueNotification(document, member, {
      type: 'reward_approved', title: `${reward.name} approved`, message: `${cost} points were spent.`, referenceId: transactionId,
    });
    return { reward_id: reward.id, claim_id: transactionId, cost, status: 'approved' };
  }

  async _disapproveReward(document, data) {
    const reward = this._findReward(document, data);
    const member = this._findMember(document, data);
    const approverName = normaliseName(data.approver_name, 'approver_name');
    const claim = this._pendingReward(document, reward, member);
    if (!claim) throw new ChoresManStoreError('claim_not_pending', `No pending request for ${reward.name}`);
    claim.status = 'disapproved';
    claim.disapproved_at = isoNow(this.now);
    claim.approver_name = approverName;
    this._event(document, { type: 'reward_disapproved', reward_id: reward.id, member_id: member.id, user_name: member.name, claim_id: claim.id, approver_name: approverName });
    this._clearNotifications(document, claim.id);
    this._queueNotification(document, member, {
      type: 'reward_disapproved', title: `${reward.name} was declined`, message: `Your reward request was declined by ${approverName}.`, referenceId: claim.id,
    });
    return { reward_id: reward.id, claim_id: claim.id, status: claim.status };
  }

  async _manualAdjustPoints(document, data) {
    const member = this._findMember(document, data);
    const amount = decimalNumber(data.amount, 'amount', 2);
    if (amount === 0) throw new ChoresManStoreError('invalid_data', 'amount cannot be 0');
    const reason = normaliseName(data.reason, 'reason');
    const approverName = data.approver_name ? normaliseName(data.approver_name, 'approver_name') : undefined;
    const entry = this._appendLedger(document, member, amount, {
      source: 'manual',
      sourceLabel: 'Manual adjustment',
      itemName: reason,
      approverName,
    });
    this._event(document, { type: 'points_adjusted', member_id: member.id, user_name: member.name, amount, reason, ...(approverName ? { approver_name: approverName } : {}) });
    if (amount > 0) this._evaluateGoals(document, { member, chore: null, points: amount, timestamp: entry.timestamp, claimId: entry.id });
    return { user_id: member.id, user_name: member.name, ledger_id: entry.id, balance: entry.balance_after };
  }

  async getLedger(data = {}) {
    const document = await this._read();
    const requestedLimit = data.limit === undefined ? 1000 : Math.floor(finiteNumber(data.limit, 'limit', { min: 1, max: 1000, decimals: 0 }));
    const member = data.user_name || data.user_id ? this._findMember(document, data, { active: false }) : null;
    const entries = document.ledger
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !member || entry.member_id === member.id)
      .sort(
        (left, right) =>
          right.entry.timestamp.localeCompare(left.entry.timestamp) || right.index - left.index,
      )
      .map(({ entry }) => entry);
    const truncated = entries.length > requestedLimit;
    const limited = entries.slice(0, requestedLimit);
    const summary = limited.reduce(
      (result, entry) => {
        if (entry.amount >= 0) result.total_earned += entry.amount;
        else result.total_spent += Math.abs(entry.amount);
        result.net += entry.amount;
        return result;
      },
      { total_earned: 0, total_spent: 0, net: 0 },
    );
    for (const key of Object.keys(summary)) summary[key] = Math.round(summary[key] * 100) / 100;
    return {
      ...(member ? { assignee_id: member.id, assignee_name: member.name } : {}),
      count: limited.length,
      limit: requestedLimit,
      truncated,
      summary,
      entries: limited.map((entry) => ({ ...entry, ...(member ? {} : { internal_id: entry.member_id, name: entry.user_name }) })),
    };
  }

  _findCatalogItem(document, collection, data, label) {
    const id = data.id || data[`${label}_id`];
    const name = data[`${label}_name`] || data.name;
    const item = document[collection].find((candidate) => id ? candidate.id === id : name && nameKey(candidate.name) === nameKey(name));
    if (!item) throw new ChoresManStoreError(`${label}_not_found`, `${label} not found: ${name || id || ''}`);
    return item;
  }

  _catalogCreate(document, collection, label, data, { pointsField = null } = {}) {
    const name = normaliseName(data.name, 'name');
    if (document[collection].some((item) => nameKey(item.name) === nameKey(name))) {
      throw new ChoresManStoreError(`duplicate_${label}`, `${label} already exists: ${name}`);
    }
    const item = {
      id: data.id || this.idFactory(),
      name,
      description: data.description ? String(data.description).trim() : '',
      icon: data.icon ? String(data.icon).trim() : '',
      labels: Object.hasOwn(data, 'labels') ? stringList(data.labels, 'labels').map((entry) => entry.toLowerCase()) : [],
      created_at: isoNow(this.now),
      updated_at: isoNow(this.now),
    };
    if (pointsField) item[pointsField] = finiteNumber(data[pointsField] ?? data.points, pointsField, { min: Number.EPSILON });
    this._applyCatalogFields(document, item, data, { pointsField });
    document[collection].push(item);
    return { [`${label}_id`]: item.id, id: item.id, name: item.name };
  }

  _applyCatalogFields(document, item, data, { pointsField = null } = {}) {
    for (const field of ['description', 'icon']) {
      if (Object.hasOwn(data, field)) item[field] = data[field] === null ? '' : String(data[field]).trim();
    }
    if (Object.hasOwn(data, 'labels')) item.labels = stringList(data.labels, 'labels').map((entry) => entry.toLowerCase());
    if (pointsField && (Object.hasOwn(data, pointsField) || Object.hasOwn(data, 'points'))) {
      item[pointsField] = finiteNumber(data[pointsField] ?? data.points, pointsField, { min: Number.EPSILON });
    }
    if (Object.hasOwn(data, 'assigned_user_names')) {
      item.assigned_member_ids = this._resolveAssignees(document, data.assigned_user_names, { allowEmpty: true });
    }
    item.updated_at = isoNow(this.now);
  }

  _catalogUpdate(document, collection, label, data, { pointsField = null } = {}) {
    const item = this._findCatalogItem(document, collection, data, label);
    if (Object.hasOwn(data, 'name') && (data.id || data[`${label}_id`])) {
      const name = normaliseName(data.name, 'name');
      if (document[collection].some((candidate) => candidate.id !== item.id && nameKey(candidate.name) === nameKey(name))) {
        throw new ChoresManStoreError(`duplicate_${label}`, `${label} already exists: ${name}`);
      }
      item.name = name;
    }
    this._applyCatalogFields(document, item, data, { pointsField });
    return { [`${label}_id`]: item.id, id: item.id, name: item.name };
  }

  _catalogDelete(document, collection, label, data) {
    const item = this._findCatalogItem(document, collection, data, label);
    document[collection] = document[collection].filter((candidate) => candidate.id !== item.id);
    return { [`${label}_id`]: item.id, deleted: true };
  }

  _applyNamedAdjustment(document, data, { kind }) {
    const isBonus = kind === 'bonus';
    const collection = isBonus ? 'bonuses' : 'penalties';
    const label = isBonus ? 'bonus' : 'penalty';
    const catalog = this._findCatalogItem(document, collection, data, label);
    const member = this._findMember(document, data);
    const approverName = normaliseName(data.approver_name, 'approver_name');
    const amount = isBonus ? catalog.points : -catalog.points;
    const entry = this._appendLedger(document, member, amount, {
      source: label,
      sourceLabel: isBonus ? 'Bonus' : 'Penalty',
      itemName: catalog.name,
      referenceId: catalog.id,
      approverName,
    });
    this._event(document, {
      type: `${label}_applied`, member_id: member.id, user_name: member.name,
      item_id: catalog.id, item_name: catalog.name, amount, approver_name: approverName,
    });
    this._queueNotification(document, member, {
      type: `${label}_applied`, title: `${catalog.name} ${isBonus ? 'awarded' : 'applied'}`,
      message: `${amount > 0 ? '+' : ''}${amount} points.`, referenceId: entry.id,
    });
    if (isBonus) this._evaluateGoals(document, { member, chore: null, points: amount, timestamp: entry.timestamp, claimId: entry.id });
    return { [`${label}_id`]: catalog.id, user_id: member.id, user_name: member.name, amount, balance: entry.balance_after };
  }

  _setRotationTurn(document, data) {
    const chore = this._findChore(document, data);
    if (!ROTATION_CRITERIA.has(chore.completion_criteria)) throw new ChoresManStoreError('not_a_rotation', `${chore.name} does not use a rotation`);
    const member = this._findMember(document, data);
    if (!this._isAssigned(chore, member.id)) throw new ChoresManStoreError('user_not_assigned', `${member.name} is not assigned to ${chore.name}`);
    chore.rotation_state ||= { current_member_id: null, open: false };
    chore.rotation_state.current_member_id = member.id;
    chore.rotation_state.open = false;
    chore.updated_at = isoNow(this.now);
    this._event(document, { type: 'rotation_turn_set', chore_id: chore.id, member_id: member.id, user_name: member.name });
    return { chore_id: chore.id, user_id: member.id, user_name: member.name };
  }

  _resetRotation(document, data) {
    const chore = this._findChore(document, data);
    if (!ROTATION_CRITERIA.has(chore.completion_criteria)) throw new ChoresManStoreError('not_a_rotation', `${chore.name} does not use a rotation`);
    const members = this._rotationMembers(document, chore);
    chore.rotation_state = { current_member_id: members[0] || null, open: false };
    chore.updated_at = isoNow(this.now);
    this._event(document, { type: 'rotation_reset', chore_id: chore.id });
    return { chore_id: chore.id, user_id: members[0] || null };
  }

  _openRotationCycle(document, data) {
    const chore = this._findChore(document, data);
    if (!ROTATION_CRITERIA.has(chore.completion_criteria)) throw new ChoresManStoreError('not_a_rotation', `${chore.name} does not use a rotation`);
    chore.rotation_state ||= { current_member_id: this._rotationMembers(document, chore)[0] || null, open: false };
    chore.rotation_state.open = true;
    chore.updated_at = isoNow(this.now);
    this._event(document, { type: 'rotation_cycle_opened', chore_id: chore.id });
    return { chore_id: chore.id, open: true };
  }

  _manageUiControl(document, data) {
    const member = this._findMember(document, data, { active: false });
    const action = data.ui_control_action;
    if (!['create', 'update', 'remove'].includes(action)) {
      throw new ChoresManStoreError('invalid_data', 'ui_control_action must be create, update, or remove');
    }
    const key = String(data.key || '').trim().replace(/^\/+|\/+$/g, '');
    let controls = document.ui_controls.find((entry) => entry.member_id === member.id);
    if (!controls) {
      controls = { member_id: member.id, user_name: member.name, values: {}, updated_at: isoNow(this.now) };
      document.ui_controls.push(controls);
    }
    if (!key && action === 'remove') {
      controls.values = {};
    } else {
      if (!key || key.split('/').some((part) => !part.trim())) throw new ChoresManStoreError('invalid_data', 'key must be a slash-delimited path');
      const parts = key.split('/');
      let cursor = controls.values;
      for (const part of parts.slice(0, -1)) {
        if (cursor[part] === undefined) cursor[part] = {};
        if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) throw new ChoresManStoreError('invalid_data', `key path conflicts at ${part}`);
        cursor = cursor[part];
      }
      const leaf = parts.at(-1);
      if (action === 'create') {
        if (!Object.hasOwn(data, 'value')) throw new ChoresManStoreError('invalid_data', 'value is required for create');
        if (Object.hasOwn(cursor, leaf)) throw new ChoresManStoreError('ui_control_exists', `UI control already exists: ${key}`);
        cursor[leaf] = clone(data.value);
      } else if (action === 'update') {
        if (!Object.hasOwn(data, 'value')) throw new ChoresManStoreError('invalid_data', 'value is required for update');
        if (!Object.hasOwn(cursor, leaf)) throw new ChoresManStoreError('ui_control_not_found', `UI control not found: ${key}`);
        cursor[leaf] = clone(data.value);
      } else {
        if (!Object.hasOwn(cursor, leaf)) throw new ChoresManStoreError('ui_control_not_found', `UI control not found: ${key}`);
        delete cursor[leaf];
      }
    }
    controls.updated_at = isoNow(this.now);
    return { user_id: member.id, user_name: member.name, key: key || null, values: controls.values };
  }

  async getNotifications(data = {}) {
    const document = await this._read();
    const member = data.user_id || data.user_name ? this._findMember(document, data, { active: false }) : null;
    return document.notifications.filter((item) => (!member || item.member_id === member.id) && (data.include_cleared === true || !item.cleared_at));
  }

  _acknowledgeNotification(document, data) {
    const notification = document.notifications.find((item) => item.id === data.notification_id || item.id === data.id);
    if (!notification) throw new ChoresManStoreError('notification_not_found', 'Notification not found');
    notification.status = 'delivered';
    notification.delivered_at = isoNow(this.now);
    return { notification_id: notification.id, status: notification.status };
  }

  _goalCollection(kind) {
    if (kind === 'badge') return 'badges';
    if (kind === 'achievement') return 'achievements';
    if (kind === 'challenge') return 'challenges';
    throw new ChoresManStoreError('invalid_data', `Unsupported goal type: ${kind}`);
  }

  _findGoal(document, kind, data) {
    const collection = this._goalCollection(kind);
    const id = data.id || data[`${kind}_id`];
    const name = data[`${kind}_name`] || data.name;
    const goal = document[collection].find((candidate) => id ? candidate.id === id : name && nameKey(candidate.name) === nameKey(name));
    if (!goal) throw new ChoresManStoreError(`${kind}_not_found`, `${kind} not found: ${name || id || ''}`);
    return goal;
  }

  _goalFields(document, goal, data, kind, { create = false } = {}) {
    const textFields = ['description', 'icon', 'linked_to', 'target_type', 'criteria', 'metric', 'frequency', 'custom_interval_unit'];
    for (const field of textFields) {
      if (Object.hasOwn(data, field)) goal[field] = data[field] === null ? null : String(data[field]).trim();
    }
    if (kind === 'badge') {
      const requestedType = data.badge_type ?? data.type;
      if (requestedType !== undefined) {
        if (!GOAL_TYPES.has(requestedType)) throw new ChoresManStoreError('invalid_data', 'badge_type must be cumulative, periodic, daily, special, or linked');
        goal.type = requestedType;
      }
    } else if (Object.hasOwn(data, 'type')) {
      goal.metric = String(data.type).trim();
    }
    for (const field of ['target_value', 'threshold_value', 'reward_points', 'award_points', 'penalty_points', 'failure_penalty_points', 'maintenance_points', 'multiplier', 'custom_interval', 'grace_days']) {
      if (!Object.hasOwn(data, field)) continue;
      const min = ['multiplier'].includes(field) ? 1 : field === 'custom_interval' || field === 'grace_days' ? 0 : 0;
      goal[field] = finiteNumber(data[field], field, { min });
    }
    for (const field of ['start_date', 'end_date', 'maintenance_start', 'maintenance_end', 'special_date']) {
      if (Object.hasOwn(data, field)) goal[field] = parseDate(data[field], field)?.toISOString() || null;
    }
    for (const field of ['enabled', 'no_overdue', 'due_only', 'recurring', 'one_time']) {
      if (Object.hasOwn(data, field)) {
        if (typeof data[field] !== 'boolean') throw new ChoresManStoreError('invalid_data', `${field} must be boolean`);
        goal[field] = data[field];
      }
    }
    if (Object.hasOwn(data, 'labels')) goal.labels = stringList(data.labels, 'labels').map((entry) => entry.toLowerCase());
    if (Object.hasOwn(data, 'awards')) {
      if (!Array.isArray(data.awards) || data.awards.some((award) => !award || typeof award !== 'object' || Array.isArray(award))) {
        throw new ChoresManStoreError('invalid_data', 'awards must be an array of objects');
      }
      goal.awards = clone(data.awards);
    }
    if (Object.hasOwn(data, 'penalties')) {
      if (!Array.isArray(data.penalties) || data.penalties.some((penalty) => !penalty || typeof penalty !== 'object' || Array.isArray(penalty))) {
        throw new ChoresManStoreError('invalid_data', 'penalties must be an array of objects');
      }
      goal.penalties = clone(data.penalties);
    }
    if (Object.hasOwn(data, 'assigned_user_names')) {
      goal.assigned_member_ids = this._resolveAssignees(document, data.assigned_user_names, { allowEmpty: !create });
    } else if (create && !goal.assigned_member_ids) {
      goal.assigned_member_ids = [ASSIGN_ALL];
    }
    if (Object.hasOwn(data, 'tracked_chore_names')) {
      const names = stringList(data.tracked_chore_names, 'tracked_chore_names');
      goal.tracked_chore_ids = names.map((name) => this._findChore(document, { chore_name: name }).id);
    }
    if (Object.hasOwn(data, 'target_type') || Object.hasOwn(data, 'criteria') || Object.hasOwn(data, 'metric')) {
      const metric = goal.target_type || goal.criteria || goal.metric;
      if (metric) metricKind(metric);
    }
    if (kind === 'badge' && goal.type === 'daily' && metricKind(goal.target_type || goal.metric || goal.criteria) === 'streak') {
      throw new ChoresManStoreError('invalid_data', 'daily badges cannot use a streak target');
    }
    if (kind === 'challenge' && goal.start_date && goal.end_date && Date.parse(goal.end_date) < Date.parse(goal.start_date)) {
      throw new ChoresManStoreError('invalid_data', 'end_date must be on or after start_date');
    }
    goal.updated_at = isoNow(this.now);
  }

  _createGoal(document, kind, data) {
    const collection = this._goalCollection(kind);
    const name = normaliseName(data.name, 'name');
    if (document[collection].some((goal) => nameKey(goal.name) === nameKey(name))) throw new ChoresManStoreError(`duplicate_${kind}`, `${kind} already exists: ${name}`);
    if (Object.hasOwn(data, 'assigned_user_names') && !Array.isArray(data.assigned_user_names)) throw new ChoresManStoreError('invalid_data', 'assigned_user_names must be an array');
    if (kind !== 'badge' && !Object.hasOwn(data, 'assigned_user_names')) throw new ChoresManStoreError('invalid_data', 'assigned_user_names is required');
    if (kind === 'badge' && !Object.hasOwn(data, 'assigned_user_names')) throw new ChoresManStoreError('invalid_data', 'assigned_user_names is required');
    const goal = { id: this.idFactory(), name, created_at: isoNow(this.now), updated_at: isoNow(this.now), enabled: true };
    if (kind === 'badge') goal.type = data.badge_type || data.type || 'periodic';
    this._goalFields(document, goal, data, kind, { create: true });
    document[collection].push(goal);
    return { [`${kind}_id`]: goal.id, id: goal.id, name: goal.name };
  }

  _updateGoal(document, kind, data) {
    const collection = this._goalCollection(kind);
    const goal = this._findGoal(document, kind, data);
    if (Object.hasOwn(data, 'name') && (data.id || data[`${kind}_id`])) {
      const name = normaliseName(data.name, 'name');
      if (document[collection].some((candidate) => candidate.id !== goal.id && nameKey(candidate.name) === nameKey(name))) throw new ChoresManStoreError(`duplicate_${kind}`, `${kind} already exists: ${name}`);
      goal.name = name;
    }
    this._goalFields(document, goal, data, kind);
    return { [`${kind}_id`]: goal.id, id: goal.id, name: goal.name };
  }

  _deleteGoal(document, kind, data) {
    const collection = this._goalCollection(kind);
    const goal = this._findGoal(document, kind, data);
    document[collection] = document[collection].filter((candidate) => candidate.id !== goal.id);
    document.goal_progress = document.goal_progress.filter((entry) => entry.goal_id !== goal.id);
    document.badge_progress = document.badge_progress.filter((entry) => entry.badge_id !== goal.id);
    document.badge_awards = document.badge_awards.filter((entry) => entry.badge_id !== goal.id);
    return { [`${kind}_id`]: goal.id, deleted: true };
  }

  _goalCycle(goal, timestamp) {
    const frequency = goal.frequency || 'none';
    const date = new Date(timestamp);
    if (frequency === 'daily') return dateKey(date);
    if (frequency === 'weekly') return startOfIsoWeek(date);
    if (frequency === 'biweekly') return `biweekly-${Math.floor(Math.max(0, Math.floor((date - new Date(goal.start_date || goal.created_at)) / 86400000)) / 14)}`;
    if (frequency === 'monthly') return monthKey(date);
    if (frequency === 'quarterly') return quarterKey(date);
    if (frequency === 'yearly') return String(date.getUTCFullYear());
    if (frequency === 'week_end') return `week-end-${startOfIsoWeek(date)}`;
    if (frequency === 'month_end') return `month-end-${monthKey(date)}`;
    if (frequency === 'quarter_end') return `quarter-end-${quarterKey(date)}`;
    if (frequency === 'year_end') return `year-end-${date.getUTCFullYear()}`;
    if (frequency === 'custom' && goal.custom_interval) {
      const unitDays = { hours: 1 / 24, days: 1, weeks: 7, months: 30 }[goal.custom_interval_unit || 'days'];
      return `custom-${Math.floor((date - new Date(goal.start_date || goal.created_at)) / (86_400_000 * unitDays * goal.custom_interval))}`;
    }
    return goal.start_date || goal.end_date ? `window-${goal.start_date || 'open'}` : 'all-time';
  }

  _goalProgress(document, collection, goalId, memberId, cycle) {
    let row = document[collection].find((entry) => entry.goal_id === goalId && entry.member_id === memberId);
    if (!row) {
      row = { id: this.idFactory(), goal_id: goalId, member_id: memberId, cycle_key: cycle, progress: 0, completed_dates: [], streak: 0, streak_history: [] };
      document[collection].push(row);
    } else if (row.cycle_key !== cycle) {
      row.cycle_key = cycle;
      row.progress = 0;
      row.completed_dates = [];
      row.completed_at = null;
    }
    if (!Array.isArray(row.streak_history)) {
      row.streak_history = row.streak > 0 && row.last_date
        ? [{ date: row.last_date, count: row.streak }]
        : [];
    }
    return row;
  }

  _recordStreakDay(row, date) {
    const history = Array.isArray(row.streak_history) ? row.streak_history : [];
    const existing = history.find((entry) => entry.date === date);
    if (existing) return Math.max(Number(existing.count) || 0, Number(row.streak) || 0);
    const previous = [...history].sort((left, right) => String(left.date).localeCompare(String(right.date))).at(-1);
    const consecutive = previous && Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${previous.date}T00:00:00.000Z`) === 86_400_000;
    const streak = consecutive ? Number(previous.count || 0) + 1 : 1;
    history.push({ date, count: streak });
    row.streak_history = history
      .sort((left, right) => String(left.date).localeCompare(String(right.date)))
      .slice(-5);
    return streak;
  }

  _repairBadgeStreak(document, data) {
    const badge = this._findGoal(document, 'badge', data);
    const member = this._findMember(document, data);
    const metric = metricKind(badge.target_type || badge.metric || badge.criteria);
    if (!['periodic', 'daily'].includes(badge.type) || metric !== 'streak' || badge.no_overdue === true) {
      throw new ChoresManStoreError('streak_repair_unsupported', 'Only periodic streak badges can be repaired');
    }
    if (badge.assigned_member_ids && !badge.assigned_member_ids.includes(ASSIGN_ALL) && !badge.assigned_member_ids.includes(member.id)) {
      throw new ChoresManStoreError('user_not_assigned', `${member.name} is not assigned to ${badge.name}`);
    }

    const explicitCount = data.badge_streak_count;
    let repairedCount;
    if (explicitCount !== undefined) {
      const parsedCount = Number(explicitCount);
      if (!Number.isInteger(parsedCount) || parsedCount < 0) {
        throw new ChoresManStoreError('invalid_data', 'badge_streak_count must be a non-negative integer');
      }
      repairedCount = parsedCount;
    } else {
      const progress = document.badge_progress.find((entry) => entry.goal_id === badge.id && entry.member_id === member.id);
      const today = dateKey(this.now());
      const firstHistoryDate = new Date(Date.parse(`${today}T00:00:00.000Z`) - 4 * 86_400_000).toISOString().slice(0, 10);
      const history = (progress?.streak_history || []).filter((entry) => entry.date >= firstHistoryDate && entry.date <= today);
      if (history.length === 0) {
        throw new ChoresManStoreError('streak_history_unavailable', 'No badge streak history is available to repair');
      }
      repairedCount = Math.max(...history.map((entry) => Number(entry.count) || 0));
    }

    const cycle = badge.type === 'daily' ? dateKey(this.now()) : this._goalCycle(badge, this.now());
    badge.current_cycle_key = cycle;
    const progress = this._goalProgress(document, 'badge_progress', badge.id, member.id, cycle);
    const yesterday = new Date(Date.parse(`${dateKey(this.now())}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
    progress.progress = repairedCount;
    progress.streak = repairedCount;
    progress.last_date = yesterday;
    const today = dateKey(this.now());
    progress.streak_history = [
      ...(progress.streak_history || []).filter((entry) => entry.date !== yesterday && entry.date !== today),
      { date: yesterday, count: repairedCount },
      { date: today, count: repairedCount },
    ].sort((left, right) => String(left.date).localeCompare(String(right.date))).slice(-5);
    if (!progress.completed_dates.includes(today)) progress.completed_dates.push(today);
    progress.updated_at = isoNow(this.now);
    const approverName = data.approver_name ? normaliseName(data.approver_name, 'approver_name') : 'Manual';
    const reason = data.reason ? normaliseName(data.reason, 'reason') : null;
    let award = null;
    const threshold = Number(badge.threshold_value || badge.target_value || 0);
    if (threshold > 0 && repairedCount >= threshold) {
      award = this._awardBadge(document, badge, member, { source: 'streak_repair', approverName });
    }
    this._event(document, {
      type: 'badge_streak_repaired', badge_id: badge.id, badge_name: badge.name,
      member_id: member.id, user_name: member.name, badge_streak_count: repairedCount,
      approver_name: approverName, ...(reason ? { reason } : {}),
    });
    return {
      badge_id: badge.id, badge_name: badge.name, user_id: member.id,
      user_name: member.name, badge_streak_count: repairedCount,
      repaired: true, award_id: award?.id || null,
    };
  }

  _awardBadge(document, badge, member, { approverName = 'Automatic', source = 'automatic' } = {}) {
    const already = document.badge_awards.some((award) => award.badge_id === badge.id && award.member_id === member.id && (!award.cycle_key || award.cycle_key === badge.current_cycle_key));
    if (already) return null;
    const award = {
      id: this.idFactory(), badge_id: badge.id, badge_name: badge.name,
      member_id: member.id, user_name: member.name, awarded_at: isoNow(this.now),
      source, approver_name: approverName,
      ...(badge.current_cycle_key ? { cycle_key: badge.current_cycle_key } : {}),
    };
    document.badge_awards.push(award);
    const configuredPoints = (badge.awards || []).filter((item) => item.type === 'points').reduce((sum, item) => sum + Number(item.amount || item.value || 0), 0);
    const points = Number(badge.award_points ?? badge.reward_points ?? configuredPoints);
    if (points > 0) this._awardPoints(document, member, points, {
      source: 'badge', sourceLabel: 'Badge award', itemName: badge.name, referenceId: award.id, approverName,
    });
    this._queueNotification(document, member, {
      type: 'badge_awarded', title: `${badge.name} earned`, message: badge.description || `You earned the ${badge.name} badge.`, referenceId: award.id,
    });
    return award;
  }

  _completeGoal(document, kind, goal, member, progress) {
    if (progress.completed_at) return false;
    progress.completed_at = isoNow(this.now);
    progress.completed = true;
    const points = Number(goal.reward_points ?? goal.award_points ?? 0);
    if (points > 0) this._awardPoints(document, member, points, {
      source: kind, sourceLabel: kind === 'achievement' ? 'Achievement' : 'Challenge',
      itemName: goal.name, referenceId: goal.id, approverName: 'Automatic',
    });
    this._queueNotification(document, member, {
      type: `${kind}_completed`, title: `${goal.name} completed`,
      message: `${goal.name} is complete${points > 0 ? ` (+${points} points)` : ''}.`, referenceId: goal.id,
    });
    for (const badge of document.badges.filter((entry) => entry.type === 'linked' && [goal.id, goal.name].includes(entry.linked_to))) {
      this._awardBadge(document, badge, member, { source: kind });
    }
    this._event(document, { type: `${kind}_completed`, goal_id: goal.id, goal_name: goal.name, member_id: member.id, user_name: member.name });
    return true;
  }

  _evaluateGoals(document, { member, chore, points = 0, timestamp = isoNow(this.now) }) {
    if (!member?.gamification_enabled) return;
    for (const badge of document.badges) {
      const assigned = !badge.assigned_member_ids || badge.assigned_member_ids.includes(ASSIGN_ALL) || badge.assigned_member_ids.includes(member.id);
      if (!assigned || badge.enabled === false || (badge.tracked_chore_ids?.length && !badge.tracked_chore_ids.includes(chore?.id))) continue;
      if (badge.type === 'cumulative') {
        const lifetime = document.ledger.filter((entry) => entry.member_id === member.id && entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0);
        const threshold = Number(badge.threshold_value || badge.target_value || 0);
        if (threshold > 0 && lifetime >= threshold) this._awardBadge(document, badge, member);
      } else if (['periodic', 'daily'].includes(badge.type)) {
        const cycle = badge.type === 'daily' ? dateKey(timestamp) : this._goalCycle(badge, timestamp);
        badge.current_cycle_key = cycle;
        const row = this._goalProgress(document, 'badge_progress', badge.id, member.id, cycle);
        const metric = metricKind(badge.target_type || badge.metric || badge.criteria);
        if (!chore && metric !== 'points') continue;
        if (metric === 'points') row.progress += points;
        else if (metric === 'days') {
          const date = dateKey(timestamp);
          if (!row.completed_dates.includes(date)) {
            row.completed_dates.push(date);
            row.progress = row.completed_dates.length;
            row.last_date = date;
          }
        } else if (metric === 'streak') {
          const date = dateKey(timestamp);
          if (!row.completed_dates.includes(date)) row.completed_dates.push(date);
          row.streak = this._recordStreakDay(row, date);
          row.progress = row.streak;
          row.last_date = date;
        } else if (metric === 'no_overdue') {
          const due = chore ? this._effectiveDueDate(chore, member.id) : null;
          if (!due || Date.parse(timestamp) <= Date.parse(due)) row.progress += 1;
        } else row.progress += 1;
        row.updated_at = isoNow(this.now);
        const target = Number(badge.threshold_value || badge.target_value || 0);
        if (target > 0 && row.progress >= target) this._awardBadge(document, badge, member, { source: 'progress' });
      } else if (badge.type === 'special') {
        const occurs = badge.special_date && dateKey(timestamp) === dateKey(badge.special_date);
        if (occurs && (!badge.tracked_chore_ids?.length || badge.tracked_chore_ids.includes(chore?.id))) this._awardBadge(document, badge, member, { source: 'special' });
      }
    }
    for (const kind of ['achievement', 'challenge']) {
      const collection = this._goalCollection(kind);
      for (const goal of document[collection]) {
        const assigned = !goal.assigned_member_ids || goal.assigned_member_ids.includes(ASSIGN_ALL) || goal.assigned_member_ids.includes(member.id);
        if (!assigned || goal.enabled === false || (goal.tracked_chore_ids?.length && !goal.tracked_chore_ids.includes(chore?.id))) continue;
        if (kind === 'challenge') {
          if (goal.start_date && Date.parse(timestamp) < Date.parse(goal.start_date)) continue;
          if (goal.end_date && Date.parse(timestamp) > Date.parse(goal.end_date)) continue;
        }
        const row = this._goalProgress(document, 'goal_progress', goal.id, member.id, kind === 'achievement' ? 'all-time' : this._goalCycle(goal, timestamp));
        if (row.completed_at) continue;
        const metric = metricKind(goal.target_type || goal.criteria || goal.metric || 'completions');
        if (!chore && metric !== 'points') continue;
        if (metric === 'points') row.progress += points;
        else if (metric === 'days') {
          const date = dateKey(timestamp);
          if (!row.completed_dates.includes(date)) {
            row.completed_dates.push(date);
            row.progress = row.completed_dates.length;
            row.last_date = date;
          }
        } else if (metric === 'streak') {
          const date = dateKey(timestamp);
          if (!row.completed_dates.includes(date)) row.completed_dates.push(date);
          row.streak = this._recordStreakDay(row, date);
          row.progress = row.streak;
          row.last_date = date;
        } else if (metric === 'no_overdue') {
          const due = chore ? this._effectiveDueDate(chore, member.id) : null;
          if (!due || Date.parse(timestamp) <= Date.parse(due)) row.progress += 1;
        } else row.progress += 1;
        row.updated_at = isoNow(this.now);
        const target = Number(goal.target_value || goal.threshold_value || 0);
        if (target > 0 && row.progress >= target) this._completeGoal(document, kind, goal, member, row);
      }
    }
  }

  _manualAwardBadge(document, data) {
    const badge = this._findGoal(document, 'badge', data);
    const member = this._findMember(document, data);
    if (badge.assigned_member_ids && !badge.assigned_member_ids.includes(ASSIGN_ALL) && !badge.assigned_member_ids.includes(member.id)) {
      throw new ChoresManStoreError('user_not_assigned', `${member.name} is not assigned to ${badge.name}`);
    }
    const award = this._awardBadge(document, badge, member, {
      source: 'manual', approverName: data.approver_name ? normaliseName(data.approver_name, 'approver_name') : 'Manual',
    });
    return { badge_id: badge.id, user_id: member.id, awarded: Boolean(award), award_id: award?.id || null };
  }

  _matchesChoreSelection(document, chore, data) {
    for (const field of ['chore_ids', 'chore_names', 'user_ids', 'user_names']) {
      if (data[field] !== undefined && !Array.isArray(data[field])) throw new ChoresManStoreError('invalid_data', `${field} must be an array`);
    }
    const ids = [...(data.chore_ids || []), ...(data.chore_id ? [data.chore_id] : [])].map(String);
    const names = [...(data.chore_names || []), ...(data.chore_name ? [data.chore_name] : [])].map(nameKey);
    if (ids.length || names.length) return ids.includes(chore.id) || names.includes(nameKey(chore.name));
    return true;
  }

  _matchesUsers(document, memberIds, data) {
    const ids = [...(data.user_ids || []), ...(data.user_id ? [data.user_id] : [])].map(String);
    const names = [...(data.user_names || []), ...(data.user_name ? [data.user_name] : [])].map(nameKey);
    if (!ids.length && !names.length) return true;
    return memberIds.some((id) => {
      const member = document.members.find((candidate) => candidate.id === id);
      return ids.includes(id) || (member && names.includes(nameKey(member.name)));
    });
  }

  _rescheduleChoresAfter(document, data) {
    const after = parseDate(data.after, 'after');
    if (!after) throw new ChoresManStoreError('invalid_data', 'after is required');
    const selectedTypes = new Set();
    if (data.reschedule_independent === true) selectedTypes.add('independent');
    if (data.reschedule_primary_standby === true) selectedTypes.add('primary_standby');
    if (data.reschedule_shared === true) selectedTypes.add('shared');
    const updated = [];
    const skipped = [];
    for (const chore of document.chores) {
      if (!this._matchesChoreSelection(document, chore, data)) continue;
      const criterion = chore.completion_criteria || 'independent';
      const category = criterion === 'independent' ? 'independent' : criterion === 'primary_standby' ? 'primary_standby' : 'shared';
      if (!selectedTypes.has(category)) continue;
      const memberIds = this._rotationMembers(document, chore);
      if (!this._matchesUsers(document, memberIds, data)) continue;
      const targets = criterion === 'independent'
        ? memberIds.filter((id) => this._matchesUsers(document, [id], data))
        : [null];
      let changed = false;
      for (const memberId of targets) {
        const due = memberId ? chore.due_date_by_member?.[memberId] || chore.due_date : chore.due_date;
        const inFlight = document.chore_claims.some((claim) => claim.chore_id === chore.id && (!memberId || claim.member_id === memberId) && claim.occurrence === cycleKey(chore, claim.member_id, this.now()) && ['in_progress', 'claimed', 'approved'].includes(claim.status));
        if (inFlight) {
          skipped.push({ chore_id: chore.id, chore_name: chore.name, user_id: memberId, reason: 'in_flight' });
          continue;
        }
        if (due && Date.parse(due) > after.getTime()) {
          skipped.push({ chore_id: chore.id, chore_name: chore.name, user_id: memberId, reason: 'already_after_boundary' });
          continue;
        }
        const frequency = chore.frequency || 'none';
        const customDays = Number(chore.custom_interval || 1) * ({ hours: 1 / 24, days: 1, weeks: 7, months: 30 }[chore.custom_interval_unit || 'days']);
        const longRecurrence = ['monthly', 'quarterly', 'yearly', 'month_end', 'quarter_end', 'year_end'].includes(frequency) || (frequency.startsWith('custom') && customDays > 14);
        if (longRecurrence && data.allow_long_recurrences !== true) {
          skipped.push({ chore_id: chore.id, chore_name: chore.name, user_id: memberId, reason: 'long_recurrence' });
          continue;
        }
        if (frequency === 'none' && data.skip_non_recurring === true) {
          skipped.push({ chore_id: chore.id, chore_name: chore.name, user_id: memberId, reason: 'non_recurring' });
          continue;
        }
        const next = frequency === 'none' ? after.toISOString() : nextDueDate(chore, after, memberId);
        if (memberId && criterion === 'independent') {
          chore.due_date_by_member ||= {};
          chore.due_date_by_member[memberId] = next || after.toISOString();
        } else chore.due_date = next || after.toISOString();
        changed = true;
      }
      if (changed) {
        chore.updated_at = isoNow(this.now);
        updated.push({ chore_id: chore.id, chore_name: chore.name, due_date: chore.due_date, due_date_by_member: clone(chore.due_date_by_member || {}) });
      }
    }
    this._event(document, { type: 'chores_rescheduled', after: after.toISOString(), updated_count: updated.length, skipped_count: skipped.length });
    return { after: after.toISOString(), updated, skipped, updated_count: updated.length, skipped_count: skipped.length };
  }

  _shiftMemberChores(document, member, action, after) {
    const result = this._rescheduleChoresAfter(document, {
      after: new Date(after).toISOString(),
      user_ids: [member.id],
      reschedule_independent: true,
      reschedule_primary_standby: ['unpause_shift_all_primary', 'unpause_shift_all'].includes(action),
      reschedule_shared: action === 'unpause_shift_all',
      skip_non_recurring: true,
    });
    return result;
  }

  _resetOverdueChores(document, data) {
    const now = this.now();
    const selected = document.chores.filter((chore) => this._matchesChoreSelection(document, chore, data));
    const updated = [];
    for (const chore of selected) {
      const targets = data.user_name || data.user_id
        ? [this._findMember(document, data).id]
        : this._rotationMembers(document, chore);
      let changed = false;
      for (const memberId of targets) {
        if (!this._isAssigned(chore, memberId) || this._isPaused(document, memberId)) continue;
        const due = this._effectiveDueDate(chore, memberId);
        if (!due || Date.parse(due) >= Date.parse(now)) continue;
        const current = cycleKey(chore, memberId, now);
        const claims = document.chore_claims.filter((claim) => claim.chore_id === chore.id && claim.member_id === memberId && claim.occurrence === current && ['in_progress', 'claimed', 'approved'].includes(claim.status));
        for (const claim of claims) {
          claim.status = 'reset';
          claim.reset_at = isoNow(this.now);
          this._clearNotifications(document, claim.id);
        }
        let next = nextDueDate(chore, due, memberId);
        for (let count = 0; next && Date.parse(next) <= Date.parse(now) && count < 100; count += 1) next = nextDueDate(chore, next, memberId);
        if (chore.completion_criteria === 'independent' && memberId) {
          chore.due_date_by_member ||= {};
          chore.due_date_by_member[memberId] = next;
        }
        else chore.due_date = next;
        this._event(document, { type: 'chore_overdue_reset', chore_id: chore.id, chore_name: chore.name, member_id: memberId, user_name: document.members.find((candidate) => candidate.id === memberId)?.name, next_due_date: next });
        this._advanceRotation(document, chore, memberId);
        changed = true;
      }
      if (changed) {
        chore.updated_at = isoNow(this.now);
        updated.push({ chore_id: chore.id, chore_name: chore.name, due_date: chore.due_date, due_date_by_member: clone(chore.due_date_by_member || {}) });
      }
    }
    return { updated, updated_count: updated.length };
  }

  _resetChoresToPending(document) {
    let reset = 0;
    for (const claim of document.chore_claims) {
      if (['in_progress', 'claimed', 'approved'].includes(claim.status)) {
        claim.status = 'reset';
        claim.reset_at = isoNow(this.now);
        this._clearNotifications(document, claim.id);
        reset += 1;
      }
    }
    this._event(document, { type: 'chores_reset_to_pending', reset_count: reset });
    return { reset_count: reset };
  }

  _resetTransactionalData(document, data) {
    if (data.confirm_destructive !== true) throw new ChoresManStoreError('confirmation_required', 'confirm_destructive must be true');
    const scope = data.scope || 'global';
    if (!['global', 'user'].includes(scope)) throw new ChoresManStoreError('invalid_data', 'scope must be global or user');
    const member = scope === 'user' ? this._findMember(document, data, { active: false }) : null;
    const type = data.item_type || null;
    const allowed = ['points', 'chores', 'rewards', 'badges', 'achievements', 'challenges', 'penalties', 'bonuses'];
    if (type && !allowed.includes(type)) throw new ChoresManStoreError('invalid_data', 'item_type is invalid');
    const itemName = data.item_name ? nameKey(data.item_name) : null;
    const memberMatch = (entry) => !member || entry.member_id === member.id || entry.user_id === member.id;
    const nameMatch = (entry) => !itemName || nameKey(entry.item_name || entry.chore_name || entry.reward_name || entry.badge_name || entry.goal_name || '') === itemName;
    const shouldReset = (entry, sourceType) => (!type || type === sourceType) && memberMatch(entry) && nameMatch(entry);
    const before = {};
    if (!type || type === 'chores') {
      before.chore_claims = document.chore_claims.length;
      document.chore_claims = document.chore_claims.filter((entry) => !shouldReset(entry, 'chores'));
      document.chore_events = document.chore_events.filter((entry) => !(memberMatch(entry) && (!itemName || nameKey(entry.chore_name || '') === itemName) && String(entry.type || '').startsWith('chore_')));
    }
    if (!type || type === 'rewards') {
      before.reward_claims = document.reward_claims.length;
      document.reward_claims = document.reward_claims.filter((entry) => !shouldReset(entry, 'rewards'));
    }
    document.ledger = document.ledger.filter((entry) => {
      const sourceType = {
        chore: 'chores', reward: 'rewards', bonus: 'bonuses', penalty: 'penalties',
        badge: 'badges', badge_penalty: 'badges', achievement: 'achievements', challenge: 'challenges',
      }[entry.source] || 'points';
      const selectedType = !type || type === 'points' || type === sourceType;
      return !(selectedType && memberMatch(entry) && nameMatch(entry));
    });
    if (!type || type === 'badges') {
      document.badge_awards = document.badge_awards.filter((entry) => !shouldReset({ ...entry, item_name: entry.badge_name }, 'badges'));
      document.badge_progress = document.badge_progress.filter((entry) => {
        const badge = document.badges.find((candidate) => candidate.id === entry.badge_id);
        return !((!member || entry.member_id === member.id) && (!itemName || nameKey(badge?.name || '') === itemName));
      });
    }
    if (!type || type === 'achievements' || type === 'challenges') {
      const goalIds = new Set([...document.achievements, ...document.challenges].filter((goal) => (!type || type === 'achievements' && document.achievements.includes(goal) || type === 'challenges' && document.challenges.includes(goal)) && (!itemName || nameKey(goal.name) === itemName)).map((goal) => goal.id));
      document.goal_progress = document.goal_progress.filter((entry) => !goalIds.has(entry.goal_id) || (member && entry.member_id !== member.id));
    }
    this._event(document, { type: 'transactional_data_reset', scope, user_name: member?.name || null, item_type: type, item_name: data.item_name || null });
    return { reset: true, scope, user_name: member?.name || null, item_type: type, removed: before };
  }

  _removeAwardedBadges(document, data) {
    const member = data.user_name || data.user_id ? this._findMember(document, data, { active: false }) : null;
    const badge = data.badge_name || data.badge_id ? this._findGoal(document, 'badge', data) : null;
    const before = document.badge_awards.length;
    document.badge_awards = document.badge_awards.filter((award) => !((!member || award.member_id === member.id) && (!badge || award.badge_id === badge.id)));
    return { removed_count: before - document.badge_awards.length, user_name: member?.name || null, badge_name: badge?.name || null };
  }

  _processChoreResetBoundary(document, chore, member, now) {
    const resetType = chore.approval_reset_type || 'upon_completion';
    const neverOverdue = isNeverOverdue(chore.overdue_handling);
    const boundaryResetType = neverOverdue && resetType === 'upon_completion' ? 'at_due_date' : resetType;
    if (!['at_due_date', 'at_midnight_once', 'at_midnight_multi'].includes(boundaryResetType)) return false;
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const due = this._effectiveDueDate(chore, member.id);
    const boundaryReached = boundaryResetType === 'at_due_date'
      ? Boolean(due && Date.parse(due) <= Date.parse(now))
      : (!due || Date.parse(due) <= Date.parse(midnight));
    if (!boundaryReached) return false;
    const boundaryKey = boundaryResetType === 'at_due_date' ? due : dateKey(midnight);
    chore.last_reset_key_by_member ||= {};
    if (chore.last_reset_key_by_member[member.id] === boundaryKey) return false;
    const claims = document.chore_claims.filter((claim) =>
      claim.chore_id === chore.id && claim.member_id === member.id &&
      (boundaryResetType === 'at_due_date'
        ? claim.due_date_at_claim === due
        : claim.approved_at && Date.parse(claim.approved_at) < Date.parse(midnight) || claim.claimed_at && Date.parse(claim.claimed_at) < Date.parse(midnight)) &&
      ['claimed', 'approved'].includes(claim.status),
    );
    if (claims.length === 0) {
      const currentTurn = this._rotationTurn(document, chore);
      if (!neverOverdue || currentTurn !== member.id ||
        !['rotation_simple', 'rotation_simple_from_turn_holder'].includes(chore.completion_criteria)) return false;
      const next = nextDueDate(chore, due, member.id);
      let nextDue = next;
      for (let count = 0; nextDue && Date.parse(nextDue) <= Date.parse(now) && count < 100; count += 1) {
        nextDue = nextDueDate(chore, nextDue, member.id);
      }
      if (!nextDue && (chore.frequency || 'none') === 'none') {
        if (chore.due_date_by_member?.[member.id]) delete chore.due_date_by_member[member.id];
        else chore.due_date = null;
      } else if (!nextDue) {
        return false;
      } else if (chore.due_date_by_member?.[member.id]) {
        chore.due_date_by_member[member.id] = nextDue;
      } else {
        chore.due_date = nextDue;
      }
      this._advanceRotation(document, chore, member.id);
      chore.last_reset_key_by_member[member.id] = boundaryKey;
      chore.updated_at = isoNow(this.now);
      this._clearNotifications(document, chore.id);
      this._event(document, {
        type: 'rotation_advanced_at_boundary', chore_id: chore.id, chore_name: chore.name,
        member_id: member.id, user_name: member.name, next_due_date: nextDue,
      });
      return true;
    }
    let completed = false;
    for (const claim of claims) {
      if (claim.status === 'approved') {
        completed = true;
        continue;
      }
      const action = chore.pending_claims || 'hold_pending';
      if (action === 'hold_pending') continue;
      if (action === 'auto_approve_pending') {
        this._automaticallyApproveClaim(document, chore, member, claim, { advanceDueDate: false });
        completed = true;
      } else {
        claim.status = 'reset';
        claim.reset_at = isoNow(this.now);
        this._clearNotifications(document, claim.id);
        this._event(document, { type: 'chore_pending_claim_cleared', chore_id: chore.id, chore_name: chore.name, member_id: member.id, user_name: member.name, claim_id: claim.id });
        this._advanceRotation(document, chore, member.id);
        completed = true;
      }
    }
    if (completed && chore.frequency && chore.frequency !== 'none' && (boundaryResetType === 'at_due_date' || boundaryResetType.startsWith('at_midnight'))) {
      const completionBoundary = isoNow(this.now);
      this._advanceChoreDate(document, chore, member.id, completionBoundary);
      this._clearNotifications(document, chore.id);
    }
    chore.last_reset_key_by_member[member.id] = boundaryKey;
    return claims.length > 0;
  }

  _runScheduledMaintenance(document) {
    const now = this.now();
    const resumed = [];
    for (const member of document.members) {
      if (!member.active || !member.paused_until || Date.parse(member.paused_until) > Date.parse(now)) continue;
      const action = member.unpause_action || 'unpause';
      if (action !== 'unpause') this._shiftMemberChores(document, member, action, now);
      member.paused = false;
      member.paused_until = null;
      member.paused_at = null;
      member.unpause_action = null;
      member.updated_at = isoNow(this.now);
      resumed.push(member.name);
      this._event(document, { type: 'chores_unpaused', member_id: member.id, user_name: member.name, unpause_action: action, automatic: true });
    }

    const beforeNotifications = document.notifications.length;
    for (const chore of document.chores) {
      const members = this._rotationMembers(document, chore);
      for (const memberId of members) {
        const member = document.members.find((candidate) => candidate.id === memberId);
        if (!member || this._isPaused(document, memberId)) continue;
        this._processChoreResetBoundary(document, chore, member, now);
        const due = this._effectiveDueDate(chore, memberId);
        if (!due) continue;
        const dueAt = Date.parse(due);
        const nowAt = Date.parse(now);
        const occurrence = cycleKey(chore, memberId, now);
        const completed = document.chore_claims.some((claim) => claim.chore_id === chore.id && claim.member_id === memberId && claim.occurrence === occurrence && claim.status === 'approved');
        if (completed) continue;
        const window = durationMilliseconds(chore.due_window_offset, 'due_window_offset');
        const reminder = durationMilliseconds(chore.due_reminder_offset, 'due_reminder_offset');
        if (chore.notify_on_due_window === true && window > 0 && nowAt >= dueAt - window && nowAt < dueAt) {
          this._queueNotification(document, member, {
            type: 'chore_due_window', title: `${chore.name} is ready`, message: `The claim window is open.`,
            referenceId: chore.id, action: 'claim_chore', dedupeKey: `due-window:${chore.id}:${memberId}:${occurrence}`,
          });
        }
        if (chore.notify_due_reminder !== false && reminder > 0 && nowAt >= dueAt - reminder && nowAt < dueAt) {
          this._queueNotification(document, member, {
            type: 'chore_due_reminder', title: `${chore.name} is due soon`, message: `This chore is due at ${due}.`,
            referenceId: chore.id, action: 'claim_chore', dedupeKey: `due-reminder:${chore.id}:${memberId}:${occurrence}`,
          });
        }
        if (chore.notify_on_overdue !== false && !isNeverOverdue(chore.overdue_handling) && nowAt >= dueAt) {
          this._queueNotification(document, member, {
            type: 'chore_overdue', title: `${chore.name} is overdue`, message: `This chore was due at ${due}.`,
            referenceId: chore.id, action: 'claim_chore', dedupeKey: `overdue:${chore.id}:${memberId}:${occurrence}`,
          });
          this._queueForParents(document, {
            type: 'chore_overdue', title: `${chore.name} is overdue`, message: `${member.name} has an overdue chore.`,
            referenceId: chore.id, action: 'reset_overdue_chores', dedupeKey: `overdue-parent:${chore.id}:${memberId}:${occurrence}`,
          });
        }
      }
    }

    let goalCyclesAdvanced = 0;
    for (const badge of document.badges.filter((candidate) => ['periodic', 'daily'].includes(candidate.type))) {
      const cycle = badge.type === 'daily' ? dateKey(now) : this._goalCycle(badge, now);
      for (const progress of document.badge_progress.filter((entry) => entry.goal_id === badge.id && entry.cycle_key !== cycle)) {
        const member = document.members.find((candidate) => candidate.id === progress.member_id);
        const target = Number(badge.threshold_value || badge.target_value || 0);
        const penalty = Number(badge.failure_penalty_points || badge.penalty_points || 0);
        if (member?.active && target > 0 && progress.progress < target && penalty > 0) {
          this._appendLedger(document, member, -penalty, {
            source: 'badge_penalty', sourceLabel: 'Badge failure penalty', itemName: badge.name, referenceId: badge.id,
          });
          this._event(document, { type: 'badge_failed', badge_id: badge.id, badge_name: badge.name, member_id: member.id, user_name: member.name, amount: -penalty });
        }
        progress.cycle_key = cycle;
        const streakMetric = metricKind(badge.target_type || badge.metric || badge.criteria) === 'streak';
        progress.progress = streakMetric ? Number(progress.streak) || 0 : 0;
        progress.completed_dates = [];
        if (!streakMetric) {
          progress.streak = 0;
          progress.last_date = null;
        }
        progress.completed_at = null;
        goalCyclesAdvanced += 1;
      }
    }
    for (const challenge of document.challenges) {
      if (challenge.end_date && Date.parse(challenge.end_date) < Date.parse(now)) challenge.expired = true;
    }
    this._event(document, { type: 'scheduled_maintenance', resumed_users: resumed, goal_cycles_advanced: goalCyclesAdvanced });
    return {
      resumed_users: resumed,
      notifications_created: document.notifications.length - beforeNotifications,
      goal_cycles_advanced: goalCyclesAdvanced,
    };
  }

  _generateActivityReport(document, data) {
    const end = this.now();
    const start = new Date(Date.parse(end) - 7 * 86_400_000);
    const member = data.user_name || data.user_id ? this._findMember(document, data, { active: false }) : null;
    const events = document.chore_events.filter((event) => Date.parse(event.timestamp) >= Date.parse(start) && Date.parse(event.timestamp) <= Date.parse(end) && (!member || event.member_id === member.id));
    const ledger = document.ledger.filter((entry) => Date.parse(entry.timestamp) >= Date.parse(start) && Date.parse(entry.timestamp) <= Date.parse(end) && (!member || entry.member_id === member.id));
    const approved = events.filter((event) => event.type === 'chore_approved').length;
    const missed = events.filter((event) => event.type === 'chore_missed' || event.type === 'chore_overdue_reset').length;
    const earned = Math.round(ledger.filter((entry) => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
    const spent = Math.round(ledger.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + Math.abs(entry.amount), 0) * 100) / 100;
    const reportLanguage = String(data.report_language || 'en');
    const title = data.report_title ? normaliseName(data.report_title, 'report_title') : 'Family Activity Report';
    const locale = ['en', 'de', 'nl'].includes(reportLanguage) ? reportLanguage : 'en';
    const range = `${start.toLocaleDateString(locale)} – ${end.toLocaleDateString(locale)}`;
    const markdown = [
      `# ${title}`,
      `_${range}${member ? ` · ${member.name}` : ''}_`,
      '',
      `- Approved chores: ${approved}`,
      `- Missed or reset chores: ${missed}`,
      `- Points earned: ${earned}`,
      `- Points spent: ${spent}`,
      '',
      '## Recent activity',
      ...(events.length ? events.slice(-50).reverse().map((event) => `- ${event.timestamp}: ${event.user_name || 'Family'} — ${event.type.replaceAll('_', ' ')}${event.chore_name ? ` (${event.chore_name})` : ''}`) : ['- No activity recorded.']),
    ].join('\n');
    const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const html = `<article><h1>${escape(title)}</h1><p><em>${escape(range)}${member ? ` · ${escape(member.name)}` : ''}</em></p><ul><li>Approved chores: ${approved}</li><li>Missed or reset chores: ${missed}</li><li>Points earned: ${earned}</li><li>Points spent: ${spent}</li></ul><h2>Recent activity</h2><ul>${events.length ? events.slice(-50).reverse().map((event) => `<li>${escape(event.timestamp)}: ${escape(event.user_name || 'Family')} — ${escape(event.type.replaceAll('_', ' '))}${event.chore_name ? ` (${escape(event.chore_name)})` : ''}</li>`).join('') : '<li>No activity recorded.</li>'}</ul></article>`;
    const format = data.output_format || 'both';
    if (!['markdown', 'html', 'both'].includes(format)) throw new ChoresManStoreError('invalid_data', 'output_format must be markdown, html, or both');
    const report = {
      user_name: member?.name || null,
      period_start: start.toISOString(), period_end: end.toISOString(),
      report_language: reportLanguage, output_format: format,
      summary: { approved_chores: approved, missed_chores: missed, points_earned: earned, points_spent: spent },
      ...(format === 'markdown' || format === 'both' ? { markdown } : {}),
      ...(format === 'html' || format === 'both' ? { html } : {}),
    };
    if (data.notify_service) {
      const recipients = member ? [member] : document.members.filter((candidate) => candidate.active && candidate.role === 'parent');
      for (const recipient of recipients) {
        const notification = this._queueNotification(document, recipient, {
          type: 'activity_report', title, message: markdown, referenceId: this.idFactory(),
        });
        if (notification) notification.channel = String(data.notify_service);
      }
    }
    return report;
  }

  async call(serviceName, data = {}) {
    const requested = String(serviceName || '');
    const familyService = requested.startsWith('family.') ? requested.slice('family.'.length) : null;
    const choresManService = requested.startsWith('choresman.')
      ? requested.slice('choresman.'.length)
      : requested;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ChoresManStoreError('invalid_data', 'Service payload must be an object');
    }
    if (familyService) {
      if (!FAMILY_SERVICE_NAMES.includes(familyService)) {
        throw new ChoresManStoreError('service_not_found', `Unsupported family service: ${requested}`);
      }
      if (familyService === 'create_member') return this.createMember(data);
      if (familyService === 'update_member') return this.updateMember(data);
      if (familyService === 'sync_members') return this.syncMembers(data);
      return this.deleteMember(data);
    }
    if (!SERVICE_NAMES.includes(choresManService)) {
      throw new ChoresManStoreError('service_not_found', `Unsupported ChoresMan action: ${serviceName}`);
    }
    if (choresManService === 'get_ledger') return this.getLedger(data);
    if (choresManService === 'get_notifications') return this.getNotifications(data);

    const handlers = {
      pause_user_chores: (document) => this._pauseUserChores(document, data),
      create_chore: (document) => this._createChore(document, data),
      update_chore: (document) => this._updateChore(document, data),
      delete_chore: (document) => this._deleteChore(document, data),
      take_chore: (document) => this._claimChore(document, data, { takeOnly: true }),
      claim_chore: (document) => this._claimChore(document, data),
      approve_chore: (document) => this._approveChore(document, data),
      disapprove_chore: (document) => this._disapproveChore(document, data),
      set_chore_due_date: (document) => this._setChoreDueDate(document, data),
      skip_chore_due_date: (document) => this._skipChoreDueDate(document, data),
      create_reward: (document) => this._createReward(document, data),
      approve_reward_definition: (document) => this._approveRewardDefinition(document, data),
      update_reward: (document) => this._updateReward(document, data),
      delete_reward: (document) => this._deleteReward(document, data),
      redeem_reward: (document) => this._redeemReward(document, data),
      approve_reward: (document) => this._approveReward(document, data),
      disapprove_reward: (document) => this._disapproveReward(document, data),
      manual_adjust_points: (document) => this._manualAdjustPoints(document, data),
      apply_bonus: (document) => this._applyNamedAdjustment(document, data, { kind: 'bonus' }),
      apply_penalty: (document) => this._applyNamedAdjustment(document, data, { kind: 'penalty' }),
      generate_activity_report: (document) => this._generateActivityReport(document, data),
      reschedule_chores_after: (document) => this._rescheduleChoresAfter(document, data),
      reset_overdue_chores: (document) => this._resetOverdueChores(document, data),
      reset_chores_to_pending_state: (document) => this._resetChoresToPending(document),
      reset_transactional_data: (document) => this._resetTransactionalData(document, data),
      remove_awarded_badges: (document) => this._removeAwardedBadges(document, data),
      repair_badge_streak: (document) => this._repairBadgeStreak(document, data),
      manage_ui_control: (document) => this._manageUiControl(document, data),
      set_rotation_turn: (document) => this._setRotationTurn(document, data),
      reset_rotation: (document) => this._resetRotation(document, data),
      open_rotation_cycle: (document) => this._openRotationCycle(document, data),
      create_bonus: (document) => this._catalogCreate(document, 'bonuses', 'bonus', data, { pointsField: 'points' }),
      update_bonus: (document) => this._catalogUpdate(document, 'bonuses', 'bonus', data, { pointsField: 'points' }),
      delete_bonus: (document) => this._catalogDelete(document, 'bonuses', 'bonus', data),
      create_penalty: (document) => this._catalogCreate(document, 'penalties', 'penalty', data, { pointsField: 'points' }),
      update_penalty: (document) => this._catalogUpdate(document, 'penalties', 'penalty', data, { pointsField: 'points' }),
      delete_penalty: (document) => this._catalogDelete(document, 'penalties', 'penalty', data),
      create_badge: (document) => this._createGoal(document, 'badge', data),
      update_badge: (document) => this._updateGoal(document, 'badge', data),
      delete_badge: (document) => this._deleteGoal(document, 'badge', data),
      award_badge: (document) => this._manualAwardBadge(document, data),
      create_achievement: (document) => this._createGoal(document, 'achievement', data),
      update_achievement: (document) => this._updateGoal(document, 'achievement', data),
      delete_achievement: (document) => this._deleteGoal(document, 'achievement', data),
      create_challenge: (document) => this._createGoal(document, 'challenge', data),
      update_challenge: (document) => this._updateGoal(document, 'challenge', data),
      delete_challenge: (document) => this._deleteGoal(document, 'challenge', data),
      run_scheduled_maintenance: (document) => this._runScheduledMaintenance(document),
      acknowledge_notification: (document) => this._acknowledgeNotification(document, data),
    };
    return this._mutate(handlers[choresManService]);
  }
}

module.exports = {
  ChoresManStoreError,
  ChoresManStore,
  SERVICE_NAMES,
  FAMILY_SERVICE_NAMES,
  SCHEMA_VERSION,
};
