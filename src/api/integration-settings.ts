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
  lists?: Array<{ title: string; reminderCountReturned: number }>;
  decodedAppleSample?: unknown;
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

export function fetchICloudRemindersPreview(): Promise<ICloudRemindersActionResult> {
  return iCloudAction<ICloudRemindersActionResult>('fetch-preview');
}
