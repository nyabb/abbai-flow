/**
 * Models the section membership JSON blob documented from the local Apple
 * Reminders store. Its exact equivalent in Apple's server response is not
 * confirmed. This module does not perform iCloud synchronization.
 */

export interface ICloudReminderSectionMembership {
  memberID: string;
  groupID: string;
  modifiedOn: number;
  [key: string]: unknown;
}

export interface ICloudReminderSectionMembershipData {
  minimumSupportedVersion: number;
  memberships: ICloudReminderSectionMembership[];
  [key: string]: unknown;
}

export interface ICloudReminderWithSection {
  id: string;
  sectionId: string | null;
}

export type SectionMembershipSource =
  | ICloudReminderSectionMembershipData
  | string
  | null
  | undefined;

const MINIMUM_SUPPORTED_VERSION = 20230430;
const CORE_DATA_UNIX_EPOCH_OFFSET_SECONDS = 978_307_200;

function normalizeIdentifier(value: string): string {
  return value.replace(/-/gu, '').toUpperCase();
}

function isMembership(value: unknown): value is ICloudReminderSectionMembership {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const membership = value as Record<string, unknown>;
  return (
    typeof membership.memberID === 'string' &&
    membership.memberID.length > 0 &&
    typeof membership.groupID === 'string' &&
    membership.groupID.length > 0 &&
    typeof membership.modifiedOn === 'number' &&
    Number.isFinite(membership.modifiedOn)
  );
}

/** Decode Apple's section membership field without discarding unknown fields. */
export function decodeSectionMembershipData(
  source: SectionMembershipSource,
): ICloudReminderSectionMembershipData {
  if (source == null || source === '') {
    return { minimumSupportedVersion: MINIMUM_SUPPORTED_VERSION, memberships: [] };
  }

  let decoded: unknown = source;
  if (typeof source === 'string') {
    try {
      decoded = JSON.parse(source) as unknown;
    } catch {
      throw new Error('Apple Reminders section membership data is not valid JSON.');
    }
  }

  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('Apple Reminders section membership data has an unsupported shape.');
  }

  const data = decoded as Record<string, unknown>;
  if (!Array.isArray(data.memberships) || !data.memberships.every(isMembership)) {
    throw new Error('Apple Reminders section membership entries are incomplete.');
  }

  return {
    ...data,
    minimumSupportedVersion:
      typeof data.minimumSupportedVersion === 'number'
        ? data.minimumSupportedVersion
        : MINIMUM_SUPPORTED_VERSION,
    memberships: data.memberships.map((membership) => ({ ...membership })),
  } as ICloudReminderSectionMembershipData;
}

/** Return the section assigned to a reminder, using the newest entry. */
export function getReminderSectionId(
  data: ICloudReminderSectionMembershipData,
  reminderId: string,
): string | null {
  const target = normalizeIdentifier(reminderId);
  const latestMembership = data.memberships
    .filter((membership) => normalizeIdentifier(membership.memberID) === target)
    .reduce<ICloudReminderSectionMembership | null>(
      (latest, membership) =>
        !latest || membership.modifiedOn > latest.modifiedOn ? membership : latest,
      null,
    );

  return latestMembership?.groupID ?? null;
}

/** Attach section IDs to decoded reminders while preserving their other data. */
export function attachReminderSections<T extends { id: string }>(
  reminders: readonly T[],
  data: ICloudReminderSectionMembershipData,
): Array<T & ICloudReminderWithSection> {
  return reminders.map((reminder) => ({
    ...reminder,
    sectionId: getReminderSectionId(data, reminder.id),
  }));
}

/** Use Apple's Core Data epoch for membership timestamps. */
export function appleCoreDataTimestamp(now = Date.now()): number {
  return now / 1000 - CORE_DATA_UNIX_EPOCH_OFFSET_SECONDS;
}

/**
 * Return a new membership blob with a reminder assigned to a section. Passing
 * `null` removes the reminder from all sections in the list.
 */
export function moveReminderToSection(
  data: ICloudReminderSectionMembershipData,
  reminderId: string,
  sectionId: string | null,
  modifiedOn = appleCoreDataTimestamp(),
): ICloudReminderSectionMembershipData {
  if (!reminderId.trim()) throw new Error('A reminder ID is required to move it.');
  if (sectionId !== null && !sectionId.trim()) {
    throw new Error('A section ID must be provided, or null to unsection the reminder.');
  }
  if (!Number.isFinite(modifiedOn)) {
    throw new Error('A valid section membership timestamp is required.');
  }

  const target = normalizeIdentifier(reminderId);
  const previousModifiedOn = data.memberships
    .filter((membership) => normalizeIdentifier(membership.memberID) === target)
    .reduce((latest, membership) => Math.max(latest, membership.modifiedOn), 0);
  const memberships = data.memberships.filter(
    (membership) => normalizeIdentifier(membership.memberID) !== target,
  );

  if (sectionId !== null) {
    memberships.push({
      memberID: reminderId,
      groupID: sectionId,
      modifiedOn: Math.max(modifiedOn, previousModifiedOn + 0.001),
    });
  }

  return {
    ...data,
    minimumSupportedVersion: Math.max(data.minimumSupportedVersion, MINIMUM_SUPPORTED_VERSION),
    memberships,
  };
}
