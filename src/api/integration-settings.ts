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
}

function integrationSettingsUrl(): string {
  const base = getRuntimeConfig() ? window.location.pathname.replace(/\/$/, '') : '';
  return `${base}/abbai-flow/settings/integrations`;
}

async function request<T>(method: string, body?: IntegrationSettingsPatch): Promise<T> {
  const response = await fetch(integrationSettingsUrl(), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
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
