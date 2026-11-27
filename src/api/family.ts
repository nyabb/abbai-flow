import {
  FamilyMember,
  Chore,
  ChoreCompletion,
  Streak,
  Routine,
  RoutineTaskCompletion,
} from '../types/family';
import { loadData, loadDataSync, saveData } from './abbai-flow-store';
import { localDayKey } from './date-keys';

const STORAGE_KEYS = {
  members: 'abbai_flow_family_members',
  chores: 'abbai_flow_chores',
  completions: 'abbai_flow_completions',
  streaks: 'abbai_flow_streaks',
  routines: 'abbai_flow_routines',
  routine_completions: 'abbai_flow_routine_completions',
  routine_mission_awards: 'abbai_flow_routine_mission_awards',
} as const;

interface RoutineMissionAwardReceipt {
  routine_id: string;
  member_id: string;
  date: string;
}

const routineMissionClaims = new Set<string>();

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanLegacyFamilyLinks(members: FamilyMember[]): FamilyMember[] {
  return members.map((member) => {
    const clean = { ...(member as FamilyMember & Record<string, unknown>) };
    delete clean.choreops_user;
    delete clean.choreops_state;
    delete clean.calendar_entity;
    delete clean.additional_calendar_entities;
    return clean as FamilyMember;
  });
}

/**
 * Family data store.
 *
 * Server (/abbai-flow/data/) is the source of truth in server-backed mode.
 * localStorage is used as a sync cache and as the primary store
 * during local development.
 *
 * Read methods are async (they fetch from server first).
 * Write methods update localStorage immediately and push to server
 * in the background.
 */
export class FamilyStore {
  // --- Members ---

  async getMembers(): Promise<FamilyMember[]> {
    const stored = await loadData<FamilyMember[]>(STORAGE_KEYS.members, []);
    const members = cleanLegacyFamilyLinks(stored);
    if (JSON.stringify(stored) !== JSON.stringify(members)) {
      await saveData(STORAGE_KEYS.members, members);
    }
    return members;
  }

  getMembersSync(): FamilyMember[] {
    return cleanLegacyFamilyLinks(loadDataSync<FamilyMember[]>(STORAGE_KEYS.members, []));
  }

  async addMember(member: Omit<FamilyMember, 'id'>): Promise<FamilyMember> {
    const members = await this.getMembers();
    const newMember: FamilyMember = { ...member, id: generateId() };
    members.push(newMember);
    await saveData(STORAGE_KEYS.members, members);
    return newMember;
  }

  async updateMember(
    id: string,
    data: Partial<Omit<FamilyMember, 'id'>>,
  ): Promise<FamilyMember | null> {
    const members = await this.getMembers();
    const index = members.findIndex((m) => m.id === id);
    if (index === -1) return null;
    members[index] = { ...members[index], ...data };
    await saveData(STORAGE_KEYS.members, members);
    return members[index];
  }

  async removeMember(id: string): Promise<boolean> {
    const members = await this.getMembers();
    const filtered = members.filter((m) => m.id !== id);
    if (filtered.length === members.length) return false;
    await saveData(STORAGE_KEYS.members, filtered);
    return true;
  }

  // --- Chores ---

  async getChores(): Promise<Chore[]> {
    return loadData<Chore[]>(STORAGE_KEYS.chores, []);
  }

  getChoresSync(): Chore[] {
    return loadDataSync<Chore[]>(STORAGE_KEYS.chores, []);
  }

  async addChore(chore: Omit<Chore, 'id'>): Promise<Chore> {
    const chores = await this.getChores();
    const newChore: Chore = { ...chore, id: generateId() };
    chores.push(newChore);
    await saveData(STORAGE_KEYS.chores, chores);
    return newChore;
  }

  async updateChore(id: string, data: Partial<Omit<Chore, 'id'>>): Promise<Chore | null> {
    const chores = await this.getChores();
    const index = chores.findIndex((c) => c.id === id);
    if (index === -1) return null;
    chores[index] = { ...chores[index], ...data };
    await saveData(STORAGE_KEYS.chores, chores);
    return chores[index];
  }

  async removeChore(id: string): Promise<boolean> {
    const chores = await this.getChores();
    const filtered = chores.filter((c) => c.id !== id);
    if (filtered.length === chores.length) return false;
    await saveData(STORAGE_KEYS.chores, filtered);
    return true;
  }

  // --- Completions ---

  async getCompletions(): Promise<ChoreCompletion[]> {
    return loadData<ChoreCompletion[]>(STORAGE_KEYS.completions, []);
  }

  getCompletionsSync(): ChoreCompletion[] {
    return loadDataSync<ChoreCompletion[]>(STORAGE_KEYS.completions, []);
  }

  async getCompletionsToday(): Promise<ChoreCompletion[]> {
    const today = localDayKey();
    const completions = await this.getCompletions();
    return completions.filter((c) => localDayKey(c.completed_at) === today);
  }

  async getCompletionsForPeriod(startDate: string, endDate: string): Promise<ChoreCompletion[]> {
    const completions = await this.getCompletions();
    return completions.filter((c) => {
      const date = localDayKey(c.completed_at);
      return date >= startDate && date <= endDate;
    });
  }

  async completeChore(
    choreId: string,
    memberId: string,
    verifiedBy?: string,
  ): Promise<ChoreCompletion> {
    const completions = await this.getCompletions();
    const today = localDayKey();
    const existing = completions.find(
      (c) =>
        c.chore_id === choreId && c.member_id === memberId && localDayKey(c.completed_at) === today,
    );
    if (existing) return existing;
    const completion: ChoreCompletion = {
      chore_id: choreId,
      member_id: memberId,
      completed_at: new Date().toISOString(),
      verified_by: verifiedBy,
    };
    completions.push(completion);
    await saveData(STORAGE_KEYS.completions, completions);

    // Update streaks
    await this.updateStreakForMember(memberId);

    return completion;
  }

  async uncompleteChore(choreId: string, memberId: string): Promise<boolean> {
    const completions = await this.getCompletions();
    const today = localDayKey();
    const index = completions.findIndex(
      (c) =>
        c.chore_id === choreId && c.member_id === memberId && localDayKey(c.completed_at) === today,
    );
    if (index === -1) return false;
    completions.splice(index, 1);
    await saveData(STORAGE_KEYS.completions, completions);
    return true;
  }

  // --- Streaks ---

  async getStreaks(): Promise<Streak[]> {
    return loadData<Streak[]>(STORAGE_KEYS.streaks, []);
  }

  async getStreakForMember(memberId: string): Promise<Streak> {
    const streaks = await this.getStreaks();
    const existing = streaks.find((s) => s.member_id === memberId);
    return existing ?? { member_id: memberId, current: 0, longest: 0, last_completed: '' };
  }

  private async updateStreakForMember(memberId: string): Promise<void> {
    const streaks = await this.getStreaks();
    const today = localDayKey();
    const yesterday = localDayKey(Date.now() - 86400000);

    let streak = streaks.find((s) => s.member_id === memberId);
    if (!streak) {
      streak = { member_id: memberId, current: 0, longest: 0, last_completed: '' };
      streaks.push(streak);
    }

    const lastDate = localDayKey(streak.last_completed);

    if (lastDate === today) {
      // Already counted today
      return;
    }

    if (lastDate === yesterday) {
      streak.current += 1;
    } else {
      streak.current = 1;
    }

    streak.longest = Math.max(streak.longest, streak.current);
    streak.last_completed = new Date().toISOString();

    await saveData(STORAGE_KEYS.streaks, streaks);
  }

  // --- Routines ---

  async getRoutines(): Promise<Routine[]> {
    return loadData<Routine[]>(STORAGE_KEYS.routines, []);
  }

  async getRoutinesForMember(memberId: string): Promise<Routine[]> {
    const routines = await this.getRoutines();
    return routines.filter((r) => r.member_id === memberId);
  }

  async updateRoutine(id: string, data: Partial<Omit<Routine, 'id'>>): Promise<Routine | null> {
    const routines = await this.getRoutines();
    const index = routines.findIndex((r) => r.id === id);
    if (index === -1) return null;
    routines[index] = { ...routines[index], ...data };
    await saveData(STORAGE_KEYS.routines, routines);
    return routines[index];
  }

  async addRoutine(routine: Omit<Routine, 'id'>): Promise<Routine> {
    const routines = await this.getRoutines();
    const newRoutine: Routine = { ...routine, id: generateId() };
    routines.push(newRoutine);
    await saveData(STORAGE_KEYS.routines, routines);
    return newRoutine;
  }

  async removeRoutine(id: string): Promise<boolean> {
    const routines = await this.getRoutines();
    const filtered = routines.filter((r) => r.id !== id);
    if (filtered.length === routines.length) return false;
    await saveData(STORAGE_KEYS.routines, filtered);
    return true;
  }

  // --- Routine task completions ---

  async getRoutineTaskCompletions(): Promise<RoutineTaskCompletion[]> {
    return loadData<RoutineTaskCompletion[]>(STORAGE_KEYS.routine_completions, []);
  }

  async getRoutineTaskCompletionsToday(): Promise<RoutineTaskCompletion[]> {
    const today = localDayKey();
    const completions = await this.getRoutineTaskCompletions();
    return completions.filter((c) => localDayKey(c.completed_at) === today);
  }

  async completeRoutineTask(routineId: string, taskId: string, memberId: string): Promise<boolean> {
    const completions = await this.getRoutineTaskCompletions();
    const today = localDayKey();
    const exists = completions.some(
      (c) =>
        c.routine_id === routineId &&
        c.task_id === taskId &&
        c.member_id === memberId &&
        localDayKey(c.completed_at) === today,
    );
    if (exists) return true;
    completions.push({
      routine_id: routineId,
      task_id: taskId,
      member_id: memberId,
      completed_at: new Date().toISOString(),
    });
    const result = await saveData(STORAGE_KEYS.routine_completions, completions);
    return result.persisted;
  }

  async uncompleteRoutineTask(
    routineId: string,
    taskId: string,
    memberId: string,
  ): Promise<boolean> {
    const completions = await this.getRoutineTaskCompletions();
    const today = localDayKey();
    const index = completions.findIndex(
      (c) =>
        c.routine_id === routineId &&
        c.task_id === taskId &&
        c.member_id === memberId &&
        localDayKey(c.completed_at) === today,
    );
    if (index === -1) return false;
    completions.splice(index, 1);
    const result = await saveData(STORAGE_KEYS.routine_completions, completions);
    return result.persisted;
  }

  /** Reserve one mission bonus for this routine/member/local day. */
  async claimRoutineMissionBonus(
    routineId: string,
    memberId: string,
    date: string = localDayKey(),
  ): Promise<boolean> {
    const claimKey = `${date}:${routineId}:${memberId}`;
    if (routineMissionClaims.has(claimKey)) return false;

    const receipts = await loadData<RoutineMissionAwardReceipt[]>(
      STORAGE_KEYS.routine_mission_awards,
      [],
    );
    if (
      receipts.some(
        (receipt) =>
          receipt.date === date &&
          receipt.routine_id === routineId &&
          receipt.member_id === memberId,
      )
    )
      return false;

    routineMissionClaims.add(claimKey);
    const cutoff = localDayKey(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const result = await saveData(STORAGE_KEYS.routine_mission_awards, [
      ...receipts.filter((receipt) => receipt.date >= cutoff),
      { routine_id: routineId, member_id: memberId, date },
    ]);
    if (!result.persisted) {
      routineMissionClaims.delete(claimKey);
      throw result.error ?? new Error('Could not save the mission bonus receipt');
    }
    return true;
  }

  /** Release a reservation only when ChoresMan rejected the points adjustment. */
  async releaseRoutineMissionBonus(
    routineId: string,
    memberId: string,
    date: string = localDayKey(),
  ): Promise<void> {
    const receipts = await loadData<RoutineMissionAwardReceipt[]>(
      STORAGE_KEYS.routine_mission_awards,
      [],
    );
    const next = receipts.filter(
      (receipt) =>
        !(
          receipt.date === date &&
          receipt.routine_id === routineId &&
          receipt.member_id === memberId
        ),
    );
    const result = await saveData(STORAGE_KEYS.routine_mission_awards, next);
    if (!result.persisted)
      throw result.error ?? new Error('Could not release the mission bonus receipt');
    routineMissionClaims.delete(`${date}:${routineId}:${memberId}`);
  }
}
