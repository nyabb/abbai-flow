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

export interface WeatherDataMapping {
  currentPath: string;
  currentTemperaturePath: string;
  currentConditionPath: string;
  currentTemperatureUnitPath: string;
  currentHumidityPath: string;
  currentWindSpeedPath: string;
  currentWindSpeedUnitPath: string;
  currentWindBearingPath: string;
  currentPressurePath: string;
  currentPressureUnitPath: string;
  currentFeelsLikePath: string;
  forecastPath: string;
  forecastDatePath: string;
  forecastConditionPath: string;
  forecastHighPath: string;
  forecastLowPath: string;
  forecastPrecipitationProbabilityPath: string;
  hourlyPath: string;
  hourlyDateTimePath: string;
  hourlyConditionPath: string;
  hourlyTemperaturePath: string;
  hourlyHumidityPath: string;
  hourlyWindSpeedPath: string;
  hourlyWindSpeedUnitPath: string;
  hourlyPrecipitationProbabilityPath: string;
}

export type WeatherApiKeyMode = 'query' | 'bearer';

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
  openMeteoUrl: string;
  weatherApiUrl: string;
  weatherApiKeyConfigured: boolean;
  weatherApiKeyMode: WeatherApiKeyMode;
  weatherApiKeyParameter: string;
  weatherDataMapping: WeatherDataMapping;
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
  openMeteoUrl?: string;
  weatherApiUrl?: string;
  weatherApiKey?: string;
  clearWeatherApiKey?: boolean;
  weatherApiKeyMode?: WeatherApiKeyMode;
  weatherApiKeyParameter?: string;
  weatherDataMapping?: Partial<WeatherDataMapping>;
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
    revision?: number;
    sections?: ICloudReminderSection[];
    reminders?: ICloudReminder[];
  }>;
  reminder?: ICloudReminder;
  reminderId?: string;
  changed?: boolean;
  revision?: number;
  revisions?: Record<string, number>;
  decodedAppleSample?: unknown;
}

export type ICloudRemindersList = NonNullable<ICloudRemindersActionResult['lists']>[number];

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

function copyICloudValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let cachedICloudLists: ICloudRemindersList[] | null = null;
const cachedICloudSnapshots = new Map<string, ICloudRemindersList>();

export function getCachedICloudRemindersLists(): ICloudRemindersList[] | null {
  return cachedICloudLists ? copyICloudValue(cachedICloudLists) : null;
}

export function clearICloudRemindersCache(): void {
  cachedICloudLists = null;
  cachedICloudSnapshots.clear();
}

export function getCachedICloudRemindersList(listKey: string): ICloudRemindersList | null {
  const list = cachedICloudSnapshots.get(listKey);
  return list ? copyICloudValue(list) : null;
}

export function getCachedICloudRemindersTaskLists(
  listKeys: string[],
): { lists: ICloudRemindersList[]; revisions: Record<string, number> } {
  const lists: ICloudRemindersList[] = [];
  const revisions: Record<string, number> = {};
  for (const key of listKeys) {
    const list = cachedICloudSnapshots.get(key);
    if (!list) continue;
    lists.push(copyICloudValue(list));
    if (typeof list.revision === 'number') revisions[key] = list.revision;
  }
  return { lists, revisions };
}

function rememberICloudList(list: ICloudRemindersList, revision?: number): void {
  const existing = cachedICloudSnapshots.get(list.key);
  const snapshot = {
    ...(existing || {}),
    ...copyICloudValue(list),
  } as ICloudRemindersList;
  if (!Array.isArray(list.reminders) && Array.isArray(existing?.reminders)) {
    snapshot.reminders = existing.reminders;
  }
  if (!Array.isArray(list.sections) && Array.isArray(existing?.sections)) {
    snapshot.sections = existing.sections;
  }
  if (typeof revision === 'number') snapshot.revision = revision;
  if (cachedICloudSnapshots.has(list.key) || Array.isArray(snapshot.reminders)) {
    cachedICloudSnapshots.set(list.key, snapshot);
  }
  if (cachedICloudLists) {
    const index = cachedICloudLists.findIndex((item) => item.key === list.key);
    if (index >= 0) cachedICloudLists[index] = { ...cachedICloudLists[index], ...snapshot };
  }
}

function rememberICloudResult(result: ICloudRemindersActionResult): ICloudRemindersActionResult {
  for (const list of result.lists || []) {
    rememberICloudList(list, list.revision ?? result.revisions?.[list.key]);
  }
  return result;
}

function updateCachedICloudReminder(
  listKey: string,
  reminderId: string,
  reminder: ICloudReminder | null,
  revision?: number,
): void {
  const snapshot = cachedICloudSnapshots.get(listKey);
  if (!snapshot) return;
  const reminders = [...(snapshot.reminders || [])];
  const index = reminders.findIndex((item) => item.id === reminderId);
  if (reminder) {
    if (index >= 0) reminders[index] = {
      ...reminders[index],
      ...copyICloudValue(reminder),
    };
    else reminders.push(copyICloudValue(reminder));
  } else if (index >= 0) {
    reminders.splice(index, 1);
  }
  snapshot.reminders = reminders;
  snapshot.reminderCountReturned = reminders.length;
  if (typeof revision === 'number') snapshot.revision = revision;
  cachedICloudSnapshots.set(listKey, snapshot);
}

function iCloudAction<T>(action: string, body: unknown = {}): Promise<T> {
  return request<T & { ok?: boolean; error?: string }>(
    'POST',
    body,
    `/abbai-flow/settings/icloud-reminders/${action}`,
  ).then((result) => {
    if (result.ok === false) throw new Error(result.error || 'The iCloud Reminders request failed.');
    return result;
  });
}

export function authenticateICloudReminders(): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('authenticate').then((result) => {
    if (result.state === 'authenticated') clearICloudRemindersCache();
    return result;
  });
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
  return iCloudAction<ICloudRemindersActionResult>('lists').then((result) => {
    if (Array.isArray(result.lists)) {
      cachedICloudLists = copyICloudValue(result.lists);
      rememberICloudResult(result);
    }
    return result;
  });
}

export function fetchICloudRemindersPreview(listKey: string): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('fetch-preview', { listKey });
}

export function fetchICloudRemindersList(
  listKey: string,
  revision?: number,
): Promise<ICloudRemindersActionResult> {
  const known = cachedICloudSnapshots.get(listKey);
  const effectiveRevision = revision ?? known?.revision;
  return iCloudAction<ICloudRemindersActionResult>('fetch-list', {
    listKey,
    revision: effectiveRevision,
  }).then((result) => {
    if (result.lists?.[0] && typeof result.revision === 'number') {
      result.lists[0].revision = result.revision;
    }
    return rememberICloudResult(result);
  });
}

export function fetchICloudRemindersTaskLists(
  listKeys: string[],
  revisions: Record<string, number> = {},
): Promise<ICloudRemindersActionResult> {
  const known = getCachedICloudRemindersTaskLists(listKeys).revisions;
  return iCloudAction<ICloudRemindersActionResult>('task-lists', {
    listKeys,
    revisions: { ...known, ...revisions },
  }).then((result) => rememberICloudResult(result));
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
  return iCloudAction<ICloudRemindersActionResult>('create-reminder', { listKey, ...values }).then((result) => {
    if (result.reminder) updateCachedICloudReminder(listKey, result.reminder.id, result.reminder, result.revision);
    return result;
  });
}

export function updateICloudReminder(
  listKey: string,
  reminderId: string,
  patch: ICloudReminderPatch,
): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('update-reminder', { listKey, reminderId, patch }).then((result) => {
    if (result.reminder) updateCachedICloudReminder(listKey, reminderId, result.reminder, result.revision);
    return result;
  });
}

export function deleteICloudReminder(
  listKey: string,
  reminderId: string,
): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('delete-reminder', { listKey, reminderId }).then((result) => {
    updateCachedICloudReminder(listKey, reminderId, null, result.revision);
    return result;
  });
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
  }).then((result) => {
    const snapshot = cachedICloudSnapshots.get(listKey);
    const reminder = snapshot?.reminders?.find((item) => item.id === reminderId);
    if (reminder && snapshot) {
      const section = sectionID == null
        ? undefined
        : snapshot.sections?.find((item) => item.id === sectionID);
      updateCachedICloudReminder(listKey, reminderId, {
        ...reminder,
        sectionID,
        sectionName: section?.name ?? null,
        sectionOrder: section?.order ?? null,
      }, result.revision);
    }
    return result;
  });
}
