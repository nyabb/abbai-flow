import { getRuntimeConfig } from '../config';

export interface MealDataMapping {
  itemsPath: string;
  idPath: string;
  titlePath: string;
  imagePath: string;
  ingredientsPath: string;
  stepsPath: string;
  tagsPath: string;
  datePath: string;
  sourceUrlPath: string;
}

export type CalendarSourceProvider = 'caldav' | 'ics' | 'google';

export interface CalendarSourceSetting {
  id: string;
  name: string;
  provider: CalendarSourceProvider;
  url: string;
  username: string;
  passwordConfigured?: boolean;
  password?: string;
  clearPassword?: boolean;
  clientId: string;
  clientSecretConfigured?: boolean;
  clientSecret?: string;
  clearClientSecret?: boolean;
}

export interface IntegrationSettingsStatus {
  haUrl: string;
  haConfigured: boolean;
  encoreUrl: string;
  encoreConfigured: boolean;
  spotifyClientId: string;
  spotifyClientSecretConfigured: boolean;
  spotifyMarket: string;
  spotifyRedirectUri: string;
  mealSourceUrl: string;
  mealSourceTokenConfigured: boolean;
  mealDataMapping: MealDataMapping;
  icloudAppleId: string;
  icloudPasswordConfigured: boolean;
  icloudRemindersListKey: string;
  icloudAuthState: string;
  icloudDevices: Array<{ index: number; name: string }>;
  icloudSecurityKeyNames: string[];
  calendarSources: CalendarSourceSetting[];
}

export interface IntegrationSettingsPatch {
  haUrl?: string;
  haToken?: string;
  clearHaToken?: boolean;
  encoreUrl?: string;
  encoreToken?: string;
  clearEncoreToken?: boolean;
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  clearSpotifyClientSecret?: boolean;
  spotifyMarket?: string;
  spotifyRedirectUri?: string;
  mealSourceUrl?: string;
  mealSourceToken?: string;
  clearMealSourceToken?: boolean;
  mealDataMapping?: Partial<MealDataMapping>;
  icloudAppleId?: string;
  icloudPassword?: string;
  clearIcloudPassword?: boolean;
  icloudRemindersListKey?: string;
  calendarSources?: CalendarSourceSetting[];
}

function integrationSettingsUrl(path = '/abbai-flow/settings/integrations'): string {
  const base = getRuntimeConfig() ? window.location.pathname.replace(/\/$/, '') : '';
  return `${base}${path}`;
}

async function request<T>(
  method: string,
  body?: unknown,
  path = '/abbai-flow/settings/integrations',
): Promise<T> {
  const response = await fetch(integrationSettingsUrl(path), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('The integration server returned a non-JSON response.');
  }
  const payload = (await response.json().catch(() => {
    throw new Error('The integration server returned invalid JSON.');
  })) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Request failed (HTTP ${response.status})`);
  return payload;
}

export function loadIntegrationSettings(): Promise<IntegrationSettingsStatus> {
  return request<IntegrationSettingsStatus>('GET');
}

export function testHomeAssistantConnection(
  values: Pick<IntegrationSettingsPatch, 'haUrl' | 'haToken' | 'clearHaToken'>,
): Promise<{ ok: true }> {
  return request<{ ok: true }>('POST', values);
}

export function saveIntegrationSettings(
  values: IntegrationSettingsPatch,
): Promise<IntegrationSettingsStatus> {
  return request<IntegrationSettingsStatus>('PUT', values);
}

export interface ICloudRemindersActionResult {
  ok: true;
  state: string;
  pyicloudVersion?: string | null;
  devices?: Array<{ index: number; name: string }>;
  securityKeyNames?: string[];
  listCount?: number;
  lists?: Array<{
    key: string;
    title: string;
    scope: string;
    deleted: boolean;
    isGroup: boolean;
    count: number | null;
    reminderCountReturned?: number;
    sections?: ICloudReminderSection[];
    reminders?: ICloudReminder[];
  }>;
  reminder?: ICloudReminder;
  reminderId?: string;
  decodedAppleSample?: unknown;
}

export interface ICloudReminderSection {
  id: string;
  name: string | null;
  order: number | null;
}

export interface ICloudReminder {
  id: string;
  list_id: string;
  title: string;
  desc: string;
  completed: boolean;
  completed_date: string | null;
  due_date: string | null;
  start_date: string | null;
  priority: number;
  flagged: boolean;
  all_day: boolean;
  deleted: boolean;
  sectionID?: string | null;
  sectionName?: string | null;
  sectionOrder?: number | null;
  [key: string]: unknown;
}

function iCloudAction<T>(action: string, body: unknown = {}): Promise<T> {
  return request<T>('POST', body, `/abbai-flow/settings/icloud-reminders/${action}`);
}

export function authenticateICloudReminders(): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('authenticate');
}

export function requestICloudRemindersVerificationCode(
  deviceIndex: number,
): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('request-code', { deviceIndex });
}

export function verifyICloudRemindersCode(code: string): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('verify-code', { code });
}

export function loadICloudRemindersLists(): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('lists');
}

export function fetchICloudRemindersPreview(listKey: string): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('fetch-preview', { listKey });
}

export function fetchICloudRemindersList(listKey: string): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('fetch-list', { listKey });
}

export interface ICloudReminderPatch {
  title?: string;
  desc?: string;
  dueDate?: string | null;
  timeZone?: string | null;
  priority?: number;
  flagged?: boolean;
  completed?: boolean;
  allDay?: boolean;
}

export function createICloudReminder(
  listKey: string,
  values: ICloudReminderPatch & { title: string; sectionID?: string | null },
): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('create-reminder', { listKey, ...values });
}

export function updateICloudReminder(
  listKey: string,
  reminderId: string,
  patch: ICloudReminderPatch,
): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('update-reminder', { listKey, reminderId, patch });
}

export function deleteICloudReminder(
  listKey: string,
  reminderId: string,
): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('delete-reminder', { listKey, reminderId });
}

export function moveICloudReminderSection(
  listKey: string,
  reminderId: string,
  sectionID: string | null,
): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('move-section', {
    listKey,
    reminderId,
    sectionID,
  });
}
