/**
 * ChoreOps user ↔ Abbai Flow family member resolution.
 *
 * Kept separate from normalisation because both the normaliser and the payload
 * builders need it, and because the linking rule (explicit link first, name
 * second) is product behaviour worth testing on its own.
 */
import type { ChoreOpsUser } from '../../types/choreops';

/** Match a ChoreOps user to a Abbai Flow family member by name (case-insensitive). */
export function matchMemberByName<T extends { name: string }>(
  userName: string | null,
  members: T[],
): T | null {
  if (!userName) return null;
  const target = userName.trim().toLowerCase();
  return members.find((member) => member.name.trim().toLowerCase() === target) ?? null;
}

/**
 * Resolve the family member for a ChoreOps user.
 *
 * An explicit `choreops_user` link always wins; a name match is the fallback so
 * associations work before anyone touches the settings UI.
 */
export function resolveMemberForUser<T extends { name: string; choreops_user?: string }>(
  userName: string | null,
  members: T[],
): T | null {
  if (!userName) return null;
  const target = userName.trim().toLowerCase();

  return (
    members.find((member) => member.choreops_user?.trim().toLowerCase() === target) ??
    matchMemberByName(userName, members)
  );
}

/**
 * Inverse of `resolveMemberForUser`: find the ChoreOps user behind a member.
 * An explicit `choreops_user` link wins, a name match is the fallback.
 */
export function findUserForMember<T extends { name: string; choreops_user?: string }>(
  member: T,
  users: ChoreOpsUser[],
): ChoreOpsUser | null {
  const link = member.choreops_user?.trim().toLowerCase();
  const byLink = link ? users.find((user) => user.name.trim().toLowerCase() === link) : undefined;
  if (byLink) return byLink;

  const name = member.name.trim().toLowerCase();
  return users.find((user) => user.name.trim().toLowerCase() === name) ?? null;
}
