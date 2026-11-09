/**
 * Pure parsing/normalisation for ChoreOps HA entities.
 *
 * No entity IDs and no attribute *names* beyond the documented `purpose`
 * discriminator are assumed: button entity IDs are discovered by scanning
 * attribute values for `button.*`, and action names are classified from the
 * attribute key they were found under. This keeps the integration working when
 * ChoreOps renames a chore/reward or adds new buttons.
 */
import type {
  ChoreOpsActionKind,
  ChoreOpsActions,
  ChoreOpsChore,
  ChoreOpsEntityState,
  ChoreOpsReward,
  ChoreOpsState,
  ChoreOpsUser,
  HaPerson,
} from '../types/choreops';

/**
 * Public surface unchanged: member resolution and the service payload builders
 * live in `./choreops/*` but are re-exported here so every existing
 * `import { … } from '../api/choreops'` keeps working.
 *
 *   ./choreops/members.ts   user ⇄ family member resolution
 *   ./choreops/payloads.ts  schedules, create/update payloads, offsets, grouping
 */
export * from './choreops/members';
export * from './choreops/payloads';

export const CHOREOPS_PURPOSE = {
  points: 'purpose_points',
  chores: 'purpose_chores',
  dashboardHelper: 'purpose_dashboard_helper',
  systemHelper: 'purpose_system_dashboard_helper',
  rewardStatus: 'purpose_reward_status',
  /**
   * One `sensor.system_choreops_<chore>_global_status` per chore, assigned or
   * not. This is the only complete, household-wide chore inventory: it carries
   * `chore_name`, `assigned_user_names`, `default_points` and the live status.
   */
  sharedChore: 'purpose_shared_chore',
  /** `sensor.<user>_choreops_chore_status_<chore>`: the real per-user status. */
  choreStatus: 'purpose_chore_status',
  /** `options` lists every chore name, including ones nobody is assigned to. */
  allChores: 'purpose_select_chores',
  pendingChoreApprovals: 'purpose_sensor_chores_pending_approval_extra',
  pendingRewardApprovals: 'purpose_sensor_rewards_pending_approval_extra',
} as const;

/**
 * Per-chore action buttons (verified on ChoreOps 1.6.0). Each chore/user pair
 * gets its own `button` entity carrying `user_name` and `chore_name`, so these
 * are the only *complete* inventory of chores â€” the dashboard helper's `chores`
 * attribute is emptied whenever nothing is due, which left the screen blank.
 */
const CHORE_BUTTON_PURPOSES: Record<string, ChoreOpsActionKind> = {
  purpose_button_chore_claim: 'claim',
  purpose_button_chore_approve: 'approve',
  purpose_button_chore_disapprove: 'disapprove',
};

/** Same idea for rewards: `purpose_button_reward_redeem` is the claim button. */
const REWARD_BUTTON_PURPOSES: Record<string, ChoreOpsActionKind> = {
  purpose_button_reward_redeem: 'claim',
  purpose_button_reward_approve: 'approve',
  purpose_button_reward_disapprove: 'disapprove',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function purposeOf(entity: ChoreOpsEntityState): string | null {
  const purpose = entity.attributes.purpose;
  return typeof purpose === 'string' ? purpose : null;
}

function str(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function flag(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}

/** Read an attribute that may be a list of strings or a single string. */
function stringList(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value];
  return [];
}

/** Classify an attribute key such as `claim_button_eid` into an action kind. */
export function actionKindFromKey(key: string): ChoreOpsActionKind | null {
  const lower = key.toLowerCase();
  if (lower.includes('disapprove')) return 'disapprove';
  if (lower.includes('approve')) return 'approve';
  if (lower.includes('claim')) return 'claim';
  return null;
}

/** Discover action button entity IDs without hardcoding attribute names. */
export function discoverActions(source: Record<string, unknown>): ChoreOpsActions {
  const actions: ChoreOpsActions = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string' || !value.startsWith('button.')) continue;
    const kind = actionKindFromKey(key);
    if (kind && !actions[kind]) actions[kind] = value;
  }

  return actions;
}

/**
 * Slug used by ChoreOps in entity IDs: `sensor.maya_choreops_points` â†’ "maya".
 * Returns null for system/shared entities (`sensor.system_choreops_...`).
 */
export function slugFromEntityId(entityId: string): string | null {
  const match = /^[a-z_]+\.([a-z0-9]+)_choreops_/.exec(entityId);
  return match ? match[1] : null;
}

function normalizeChore(item: unknown, fallbackAssignee: string | null): ChoreOpsChore | null {
  if (!isRecord(item)) return null;

  const name = str(item, 'name') ?? str(item, 'chore_name') ?? str(item, 'friendly_name');
  const eid = str(item, 'eid') ?? str(item, 'entity_id');
  const assignee = str(item, 'user_name') ?? str(item, 'assignee') ?? fallbackAssignee;

  if (!name && !eid) return null;

  return {
    id: eid ?? `${assignee ?? 'shared'}:${name ?? 'chore'}`,
    name: name ?? eid ?? 'Chore',
    icon: str(item, 'icon'),
    status: str(item, 'status') ?? str(item, 'state') ?? 'unknown',
    assignee,
    points: pointsOf(item),
    canClaim: flag(item, 'can_claim'),
    canApprove: flag(item, 'can_approve'),
    completionCriteria: str(item, 'completion_criteria'),
    assignedUserNames: stringList(item, 'assigned_user_names'),
    labels: stringList(item, 'labels'),
    lastCompleted: str(item, 'last_completed'),
    actions: discoverActions(item),
  };
}

/**
 * Optional per-chore reward. ChoreOps does not publish a points field on every
 * `chores` item shape, so probe the keys seen in practice and return null when
 * none is present â€” the card then hides the reward badge instead of inventing
 * a number.
 */
function pointsOf(source: Record<string, unknown>): number | null {
  for (const key of ['points', 'points_value', 'chore_points', 'punten']) {
    const value = num(source, key);
    if (value !== null) return value;
  }
  return null;
}

/** Join key for per-chore buttons: the same chore can exist for several users. */
function choreKey(assignee: string | null, name: string): string {
  return `${(assignee ?? '').trim().toLowerCase()}::${name.trim().toLowerCase()}`;
}

function normalizeReward(entity: ChoreOpsEntityState): ChoreOpsReward | null {
  const name = str(entity.attributes, 'reward_name');
  if (!name) return null;

  return {
    id: entity.entity_id,
    name,
    status: entity.state,
    cost: num(entity.attributes, 'cost') ?? 0,
    pendingClaims: num(entity.attributes, 'pending_claims') ?? 0,
    assignee: str(entity.attributes, 'user_name'),
    actions: discoverActions(entity.attributes),
  };
}

/**
 * Build the normalized ChoreOps view from a full HA state snapshot.
 *
 * Chore and reward lists are built from the per-action `button` entities, which
 * ChoreOps always publishes per user. The dashboard helper's `chores` attribute
 * is used as enrichment (icon, status, points) when it happens to be populated.
 */
export function normalizeChoreOps(states: ChoreOpsEntityState[]): ChoreOpsState {
  const usersBySlug = new Map<string, ChoreOpsUser>();
  const rewards: ChoreOpsReward[] = [];
  const helperChores: ChoreOpsChore[] = [];
  const sharedChores: ChoreOpsChore[] = [];
  const allChoreNames: string[] = [];
  const choreButtons = new Map<string, ChoreOpsChore>();
  const choreStatuses = new Map<
    string,
    {
      assignee: string;
      name: string;
      status: string;
      points: number | null;
      icon: string | null;
      dueDate: string | null;
      description: string | null;
      frequency: string | null;
      applicableDays: string[];
      windowOffset: string | null;
      autoApprove: boolean;
      assignedUserNames: string[];
      completionCriteria: string | null;
      labels: string[];
      lastCompleted: string | null;
      canClaim: boolean;
      canApprove: boolean;
    }
  >();
  const rewardButtons = new Map<string, ChoreOpsReward>();
  const pendingApprovals = { chores: 0, rewards: 0 };
  let entryId: string | null = null;
  const people: HaPerson[] = [];
  let available = false;

  const ensureUser = (slug: string, name: string): ChoreOpsUser => {
    const existing = usersBySlug.get(slug);
    if (existing) return existing;
    const created: ChoreOpsUser = {
      name,
      slug,
      points: 0,
      dueToday: 0,
      claimed: 0,
      approved: 0,
      completedToday: 0,
    };
    usersBySlug.set(slug, created);
    return created;
  };

  for (const entity of states) {
    // HA persons exist independently of ChoreOps (e.g. parents who do not do
    // chores) so collect them before the purpose check filters them out.
    if (entity.entity_id.startsWith('person.')) {
      const name = str(entity.attributes, 'friendly_name');
      if (name) {
        people.push({
          entityId: entity.entity_id,
          name,
          picture: str(entity.attributes, 'entity_picture'),
        });
      }
      continue;
    }

    const purpose = purposeOf(entity);
    if (!purpose) continue;

    const slug = slugFromEntityId(entity.entity_id);
    const userName = str(entity.attributes, 'user_name');

    if (purpose === CHOREOPS_PURPOSE.points && slug && userName) {
      available = true;
      ensureUser(slug, userName).points = Number(entity.state) || 0;
      continue;
    }

    if (purpose === CHOREOPS_PURPOSE.chores && slug && userName) {
      available = true;
      const user = ensureUser(slug, userName);
      user.dueToday = num(entity.attributes, 'chore_stat_current_due_today') ?? 0;
      user.claimed = num(entity.attributes, 'chore_stat_current_claimed') ?? 0;
      user.approved = num(entity.attributes, 'chore_stat_current_approved') ?? 0;
      user.completedToday = num(entity.attributes, 'chore_stat_completed_today') ?? 0;
      continue;
    }

    if (purpose === CHOREOPS_PURPOSE.dashboardHelper) {
      available = true;
      const assignee = userName ?? (slug ? ensureUser(slug, slug).name : null);
      const rawChores = entity.attributes.chores;
      if (Array.isArray(rawChores)) {
        for (const item of rawChores) {
          const chore = normalizeChore(item, assignee);
          if (chore) helperChores.push(chore);
        }
      }
      continue;
    }

    if (purpose === CHOREOPS_PURPOSE.sharedChore) {
      available = true;
      const choreName = str(entity.attributes, 'chore_name');
      if (choreName) {
        // One record per assignee so each child gets their own card; a chore
        // with nobody assigned becomes a single "everyone" entry.
        const assignees = stringList(entity.attributes, 'assigned_user_names');
        const targets: Array<string | null> = assignees.length > 0 ? assignees : [null];
        const completionCriteria = str(entity.attributes, 'completion_criteria');
        for (const assignee of targets) {
          sharedChores.push({
            // One sensor covers every assignee, so the assignee keeps the ids unique.
            id: `${entity.entity_id}::${assignee ?? ''}`,
            name: choreName,
            icon: str(entity.attributes, 'icon'),
            status: entity.state,
            assignee,
            points: num(entity.attributes, 'default_points'),
            assignedUserNames: assignees,
            completionCriteria,
            canClaim: false,
            canApprove: false,
            actions: {},
          });
        }
      }
      continue;
    }

    if (purpose === CHOREOPS_PURPOSE.allChores) {
      available = true;
      for (const name of stringList(entity.attributes, 'options')) {
        if (name.trim().toLowerCase() !== 'none') allChoreNames.push(name.trim());
      }
      continue;
    }

    if (purpose === CHOREOPS_PURPOSE.pendingChoreApprovals) {
      pendingApprovals.chores = Number(entity.state) || 0;
      continue;
    }

    if (purpose === CHOREOPS_PURPOSE.choreStatus) {
      available = true;
      const choreName = str(entity.attributes, 'chore_name');
      if (userName && choreName) {
        if (slug) ensureUser(slug, userName);
        choreStatuses.set(choreKey(userName, choreName), {
          assignee: userName,
          name: choreName,
          status: entity.state,
          points: num(entity.attributes, 'default_points'),
          icon: str(entity.attributes, 'icon'),
          dueDate: str(entity.attributes, 'due_date') ?? str(entity.attributes, 'available_at'),
          description: str(entity.attributes, 'description'),
          frequency: str(entity.attributes, 'recurring_frequency'),
          applicableDays: stringList(entity.attributes, 'applicable_days'),
          labels: stringList(entity.attributes, 'labels'),
          lastCompleted: str(entity.attributes, 'last_completed'),
          windowOffset: str(entity.attributes, 'chore_due_window_offset'),
          autoApprove: flag(entity.attributes, 'auto_approve'),
          assignedUserNames: stringList(entity.attributes, 'assigned_user_names'),
          completionCriteria: str(entity.attributes, 'completion_criteria'),
          canClaim: flag(entity.attributes, 'can_claim'),
          canApprove: flag(entity.attributes, 'can_approve'),
        });
      }
      continue;
    }

    if (purpose === CHOREOPS_PURPOSE.systemHelper) {
      available = true;
      entryId = entryId ?? str(entity.attributes, 'integration_entry_id');
      continue;
    }

    if (purpose === CHOREOPS_PURPOSE.pendingRewardApprovals) {
      pendingApprovals.rewards = Number(entity.state) || 0;
      continue;
    }

    // Per-chore action buttons: the authoritative chore inventory.
    const choreKind = CHORE_BUTTON_PURPOSES[purpose];
    if (choreKind) {
      available = true;
      const choreName = str(entity.attributes, 'chore_name');
      if (userName && choreName) {
        if (slug) ensureUser(slug, userName);
        const key = choreKey(userName, choreName);
        const entry = choreButtons.get(key) ?? {
          id: entity.entity_id,
          name: choreName,
          icon: null,
          status: 'available',
          assignee: userName,
          points: null,
          canClaim: false,
          canApprove: false,
          actions: {},
        };
        entry.actions[choreKind] = entity.entity_id;
        entry.canClaim = Boolean(entry.actions.claim);
        entry.canApprove = Boolean(entry.actions.approve);
        choreButtons.set(key, entry);
      }
      continue;
    }

    const rewardKind = REWARD_BUTTON_PURPOSES[purpose];
    if (rewardKind) {
      available = true;
      const rewardName = str(entity.attributes, 'reward_name');
      if (userName && rewardName) {
        // Rewards are per user: the same reward name exists once per assignee.
        const key = choreKey(userName, rewardName);
        const entry = rewardButtons.get(key) ?? {
          id: entity.entity_id,
          name: rewardName,
          status: 'available',
          cost: 0,
          pendingClaims: 0,
          assignee: userName,
          actions: {},
        };
        entry.actions[rewardKind] = entity.entity_id;
        rewardButtons.set(key, entry);
      }
      continue;
    }

    if (purpose === CHOREOPS_PURPOSE.rewardStatus) {
      available = true;
      const reward = normalizeReward(entity);
      if (reward) rewards.push(reward);
    }
  }

  const users = Array.from(usersBySlug.values()).sort((a, b) => a.name.localeCompare(b.name));
  const pointsByUser: Record<string, number> = {};
  for (const user of users) pointsByUser[user.name.trim().toLowerCase()] = user.points;

  // Merge: the dashboard helper knows the extra details (icon/status/points) but
  // only lists chores that are due; the buttons know every chore but carry no
  // metadata. Buttons win on actions, helper items win on presentation.
  const choreMap = new Map<string, ChoreOpsChore>();
  for (const chore of sharedChores) {
    choreMap.set(choreKey(chore.assignee, chore.name), chore);
  }
  for (const chore of helperChores) {
    const key = choreKey(chore.assignee, chore.name);
    const existing = choreMap.get(key);
    if (existing) {
      existing.icon = existing.icon ?? chore.icon;
      existing.status = chore.status;
      existing.points = existing.points ?? chore.points;
      existing.completionCriteria = existing.completionCriteria ?? chore.completionCriteria;
      if (!existing.assignedUserNames?.length && chore.assignedUserNames?.length) {
        existing.assignedUserNames = chore.assignedUserNames;
      }
      continue;
    }
    choreMap.set(key, chore);
  }
  for (const [key, chore] of choreButtons) {
    const existing = choreMap.get(key);
    if (existing) {
      existing.actions = { ...existing.actions, ...chore.actions };
      existing.canClaim = Boolean(existing.actions.claim);
      existing.canApprove = Boolean(existing.actions.approve);
      continue;
    }
    choreMap.set(key, chore);
  }

  // The per-user status sensors are the only accurate status source; apply them
  // last so a claim made in HA shows up here without waiting for a helper array.
  for (const [key, record] of choreStatuses) {
    const existing = choreMap.get(key);
    if (existing) {
      existing.status = record.status;
      existing.points = existing.points ?? record.points;
      existing.icon = existing.icon ?? record.icon;
      existing.dueDate = record.dueDate ?? existing.dueDate;
      existing.description = record.description ?? existing.description;
      existing.frequency = record.frequency ?? existing.frequency;
      if (record.applicableDays.length > 0) existing.applicableDays = record.applicableDays;
      existing.windowOffset = record.windowOffset ?? existing.windowOffset;
      existing.autoApprove = record.autoApprove;
      if (record.assignedUserNames.length > 0) {
        existing.assignedUserNames = record.assignedUserNames;
      }
      existing.completionCriteria = record.completionCriteria ?? existing.completionCriteria;
      if (record.labels.length > 0) existing.labels = record.labels;
      existing.lastCompleted = record.lastCompleted ?? existing.lastCompleted;
      if (record.canClaim) existing.canClaim = true;
      if (record.canApprove) existing.canApprove = true;
      continue;
    }
    choreMap.set(key, {
      id: `status:${key}`,
      name: record.name,
      icon: record.icon,
      status: record.status,
      assignee: record.assignee,
      points: record.points,
      dueDate: record.dueDate,
      description: record.description,
      frequency: record.frequency,
      applicableDays: record.applicableDays,
      windowOffset: record.windowOffset,
      autoApprove: record.autoApprove,
      assignedUserNames: record.assignedUserNames,
      completionCriteria: record.completionCriteria,
      labels: record.labels,
      lastCompleted: record.lastCompleted,
      canClaim: record.canClaim,
      canApprove: record.canApprove,
      actions: {},
    });
  }

  // Chores nobody is assigned to appear only in the select's option list, and
  // ChoreOps publishes no claim button for them â€” they are listed so they can be
  // seen (and fixed in ChoreOps), not so they can be claimed. Runs last so a
  // chore that is reachable through a button is never duplicated here.
  const knownChoreNames = new Set(
    Array.from(choreMap.values()).map((chore) => chore.name.trim().toLowerCase()),
  );
  for (const name of allChoreNames) {
    const normalized = name.trim().toLowerCase();
    if (knownChoreNames.has(normalized)) continue;
    knownChoreNames.add(normalized);
    choreMap.set(choreKey(null, name), {
      id: `chore:${normalized}`,
      name,
      icon: null,
      status: 'unassigned',
      assignee: null,
      points: null,
      canClaim: false,
      canApprove: false,
      actions: {},
    });
  }

  const rewardMap = new Map<string, ChoreOpsReward>();
  for (const reward of rewards) {
    rewardMap.set(choreKey(reward.assignee, reward.name), reward);
  }
  for (const [key, reward] of rewardButtons) {
    let existing = rewardMap.get(key);
    if (!existing) {
      // A status sensor that did not publish `user_name` still belongs to the
      // user we know from the button, so adopt that user instead of duplicating.
      const anonymousKey = choreKey(null, reward.name);
      const anonymous = rewardMap.get(anonymousKey);
      if (anonymous && !anonymous.assignee) {
        rewardMap.delete(anonymousKey);
        anonymous.assignee = reward.assignee ?? null;
        existing = anonymous;
        rewardMap.set(choreKey(anonymous.assignee, anonymous.name), anonymous);
      }
    }
    if (existing) {
      existing.actions = { ...existing.actions, ...reward.actions };
      existing.assignee = existing.assignee ?? reward.assignee;
      if (reward.cost > 0) existing.cost = reward.cost;
      continue;
    }
    rewardMap.set(key, reward);
  }

  return {
    users,
    chores: Array.from(choreMap.values()),
    rewards: Array.from(rewardMap.values()),
    people,
    pointsByUser,
    pendingApprovals,
    entryId,
    available,
  };
}
