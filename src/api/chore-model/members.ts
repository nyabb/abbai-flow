import type { ChoresManUser } from '../../types/choresman';

/** Resolve a ChoresMan user to a family member by their display name. */
export function resolveMemberForUser<T extends { name: string }>(
  userName: string | null,
  members: T[],
): T | null {
  if (!userName) return null;
  const target = userName.trim().toLocaleLowerCase();
  return members.find((member) => member.name.trim().toLocaleLowerCase() === target) ?? null;
}

/** Resolve a family member to the matching ChoresMan user. */
export function findUserForMember<T extends { name: string }>(
  member: T,
  users: ChoresManUser[],
): ChoresManUser | null {
  const target = member.name.trim().toLocaleLowerCase();
  return users.find((user) => user.name.trim().toLocaleLowerCase() === target) ?? null;
}
