/**
 * Integrations settings: iCloud Reminders, calendars, weather, music, and meals.
 *
 * The iCloud list lookup feeds the grocery and task list selectors below.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import {
  loadIntegrationSettings,
  saveIntegrationSettings,
  authenticateICloudReminders,
  loadICloudRemindersLists,
  requestICloudRemindersVerificationCode,
  verifyICloudRemindersCode,
  fetchICloudRemindersPreview,
  type IntegrationSettingsPatch,
  type ICloudRemindersActionResult,
  type MealDataMapping,
  type WeatherApiKeyMode,
  type WeatherDataMapping,
  type IntegrationSettingsStatus,
  type CalendarSourceSetting,
} from '../../../api/integration-settings';
import { testCalendarSource as testCalendarSourceApi } from '../../../api/caldav-calendars';
import { testWeatherConfiguration } from '../../../api/open-meteo';
import { getRuntimeConfig } from '../../../config';
import type { TranslationKey } from '../../../i18n';
import { LoadingPlaceholder } from '../../LoadingPlaceholder';
import { SettingsErrorBadge } from '../../SettingsErrorBadge';
import { SecretInput } from '../SecretInput';
import type { SettingsSectionContext } from './context';
import type { SettingsAttention } from '../../../hooks/useIntegrationHealth';

const EMPTY_MEAL_DATA_MAPPING: MealDataMapping = {
  itemsPath: '',
  idPath: '',
  titlePath: '',
  imagePath: '',
  ingredientsPath: '',
  stepsPath: '',
  tagsPath: '',
  datePath: '',
  sourceUrlPath: '',
};

const DEFAULT_WEATHER_DATA_MAPPING: WeatherDataMapping = {
  currentPath: '$.current',
  currentTemperaturePath: '$.temperature',
  currentConditionPath: '$.condition',
  currentTemperatureUnitPath: '$.temperatureUnit',
  currentHumidityPath: '$.humidity',
  currentWindSpeedPath: '$.windSpeed',
  currentWindSpeedUnitPath: '$.windSpeedUnit',
  currentWindBearingPath: '$.windBearing',
  currentPressurePath: '$.pressure',
  currentPressureUnitPath: '$.pressureUnit',
  currentFeelsLikePath: '$.feelsLike',
  forecastPath: '$.forecast',
  forecastDatePath: '$.datetime',
  forecastConditionPath: '$.condition',
  forecastHighPath: '$.temperature',
  forecastLowPath: '$.templow',
  forecastPrecipitationProbabilityPath: '$.precipitation_probability',
  hourlyPath: '$.hourly',
  hourlyDateTimePath: '$.datetime',
  hourlyConditionPath: '$.condition',
  hourlyTemperaturePath: '$.temperature',
  hourlyHumidityPath: '$.humidity',
  hourlyWindSpeedPath: '$.wind_speed',
  hourlyWindSpeedUnitPath: '$.wind_speed_unit',
  hourlyPrecipitationProbabilityPath: '$.precipitation_probability',
};

type ICloudRemindersListOption = NonNullable<ICloudRemindersActionResult['lists']>[number];

const GROCERY_LIST_HINTS = [
  'grocer',
  'shopping',
  'costco',
  'walmart',
  'target',
  'store',
  'pantry',
  'fridge',
  'freezer',
  'inventory',
  'meal',
];

function isProbablyGroceryList(title: string): boolean {
  const normalized = title.toLowerCase();
  return GROCERY_LIST_HINTS.some((hint) => normalized.includes(hint));
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back for embedded browsers and non-secure contexts.
  }

  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, field.value.length);
  try {
    return document.execCommand('copy');
  } finally {
    field.remove();
  }
}

const MEAL_MAPPING_FIELDS: {
  key: keyof MealDataMapping;
  labelKey: TranslationKey;
  placeholder: string;
}[] = [
  {
    key: 'itemsPath',
    labelKey: 'settings.integrations.mealItemsPathLabel',
    placeholder: '$.recipes',
  },
  { key: 'idPath', labelKey: 'settings.integrations.mealIdPathLabel', placeholder: '$.id' },
  {
    key: 'titlePath',
    labelKey: 'settings.integrations.mealTitlePathLabel',
    placeholder: '$.name',
  },
  {
    key: 'imagePath',
    labelKey: 'settings.integrations.mealImagePathLabel',
    placeholder: '$.image.url',
  },
  {
    key: 'ingredientsPath',
    labelKey: 'settings.integrations.mealIngredientsPathLabel',
    placeholder: '$.ingredients[]',
  },
  {
    key: 'stepsPath',
    labelKey: 'settings.integrations.mealStepsPathLabel',
    placeholder: '$.instructions[].text',
  },
  { key: 'tagsPath', labelKey: 'settings.integrations.mealTagsPathLabel', placeholder: '$.tags[]' },
  { key: 'datePath', labelKey: 'settings.integrations.mealDatePathLabel', placeholder: '$.date' },
  {
    key: 'sourceUrlPath',
    labelKey: 'settings.integrations.mealSourceUrlPathLabel',
    placeholder: '$.url',
  },
];

const WEATHER_MAPPING_FIELDS: {
  key: keyof WeatherDataMapping;
  labelKey: TranslationKey;
  placeholder: string;
  group: 'current' | 'forecast' | 'hourly';
}[] = [
  { key: 'currentPath', labelKey: 'settings.integrations.weatherCurrentPathLabel', placeholder: '$.current', group: 'current' },
  { key: 'currentTemperaturePath', labelKey: 'settings.integrations.weatherCurrentTemperaturePathLabel', placeholder: '$.temperature', group: 'current' },
  { key: 'currentConditionPath', labelKey: 'settings.integrations.weatherCurrentConditionPathLabel', placeholder: '$.condition', group: 'current' },
  { key: 'currentTemperatureUnitPath', labelKey: 'settings.integrations.weatherCurrentTemperatureUnitPathLabel', placeholder: '$.temperatureUnit', group: 'current' },
  { key: 'currentHumidityPath', labelKey: 'settings.integrations.weatherCurrentHumidityPathLabel', placeholder: '$.humidity', group: 'current' },
  { key: 'currentWindSpeedPath', labelKey: 'settings.integrations.weatherCurrentWindSpeedPathLabel', placeholder: '$.windSpeed', group: 'current' },
  { key: 'currentWindSpeedUnitPath', labelKey: 'settings.integrations.weatherCurrentWindSpeedUnitPathLabel', placeholder: '$.windSpeedUnit', group: 'current' },
  { key: 'currentWindBearingPath', labelKey: 'settings.integrations.weatherCurrentWindBearingPathLabel', placeholder: '$.windBearing', group: 'current' },
  { key: 'currentPressurePath', labelKey: 'settings.integrations.weatherCurrentPressurePathLabel', placeholder: '$.pressure', group: 'current' },
  { key: 'currentPressureUnitPath', labelKey: 'settings.integrations.weatherCurrentPressureUnitPathLabel', placeholder: '$.pressureUnit', group: 'current' },
  { key: 'currentFeelsLikePath', labelKey: 'settings.integrations.weatherCurrentFeelsLikePathLabel', placeholder: '$.feelsLike', group: 'current' },
  { key: 'forecastPath', labelKey: 'settings.integrations.weatherForecastPathLabel', placeholder: '$.forecast', group: 'forecast' },
  { key: 'forecastDatePath', labelKey: 'settings.integrations.weatherForecastDatePathLabel', placeholder: '$.datetime', group: 'forecast' },
  { key: 'forecastConditionPath', labelKey: 'settings.integrations.weatherForecastConditionPathLabel', placeholder: '$.condition', group: 'forecast' },
  { key: 'forecastHighPath', labelKey: 'settings.integrations.weatherForecastHighPathLabel', placeholder: '$.temperature', group: 'forecast' },
  { key: 'forecastLowPath', labelKey: 'settings.integrations.weatherForecastLowPathLabel', placeholder: '$.templow', group: 'forecast' },
  { key: 'forecastPrecipitationProbabilityPath', labelKey: 'settings.integrations.weatherForecastPrecipitationPathLabel', placeholder: '$.precipitation_probability', group: 'forecast' },
  { key: 'hourlyPath', labelKey: 'settings.integrations.weatherHourlyPathLabel', placeholder: '$.hourly', group: 'hourly' },
  { key: 'hourlyDateTimePath', labelKey: 'settings.integrations.weatherHourlyDateTimePathLabel', placeholder: '$.datetime', group: 'hourly' },
  { key: 'hourlyConditionPath', labelKey: 'settings.integrations.weatherHourlyConditionPathLabel', placeholder: '$.condition', group: 'hourly' },
  { key: 'hourlyTemperaturePath', labelKey: 'settings.integrations.weatherHourlyTemperaturePathLabel', placeholder: '$.temperature', group: 'hourly' },
  { key: 'hourlyHumidityPath', labelKey: 'settings.integrations.weatherHourlyHumidityPathLabel', placeholder: '$.humidity', group: 'hourly' },
  { key: 'hourlyWindSpeedPath', labelKey: 'settings.integrations.weatherHourlyWindSpeedPathLabel', placeholder: '$.wind_speed', group: 'hourly' },
  { key: 'hourlyWindSpeedUnitPath', labelKey: 'settings.integrations.weatherHourlyWindSpeedUnitPathLabel', placeholder: '$.wind_speed_unit', group: 'hourly' },
  { key: 'hourlyPrecipitationProbabilityPath', labelKey: 'settings.integrations.weatherHourlyPrecipitationPathLabel', placeholder: '$.precipitation_probability', group: 'hourly' },
];

const WEATHER_MAPPING_GROUPS = [
  { id: 'current', labelKey: 'settings.integrations.weatherCurrentGroup' },
  { id: 'forecast', labelKey: 'settings.integrations.weatherForecastGroup' },
  { id: 'hourly', labelKey: 'settings.integrations.weatherHourlyGroup' },
] as const;

interface SavedSecretControlProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  configured: boolean;
  disabled?: boolean;
  busy: boolean;
  removeLabel: string;
  onRemove?: () => void;
}

function SavedSecretControl({
  label,
  value,
  onChange,
  configured,
  disabled = false,
  busy,
  removeLabel,
  onRemove,
}: SavedSecretControlProps) {
  return (
    <div className="settings-secret-control">
      <SecretInput
        label={label}
        value={value}
        onChange={onChange}
        autoComplete="new-password"
        disabled={disabled || configured}
      />
      {configured && onRemove && (
        <button
          type="button"
          className="settings-fm-btn settings-fm-btn--danger settings-secret-remove"
          aria-label={removeLabel}
          title={removeLabel}
          onClick={onRemove}
          disabled={busy}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

type ClearSecretField =
  | 'clearWeatherApiKey'
  | 'clearSpotifyClientSecret'
  | 'clearMealSourceToken'
  | 'clearIcloudPassword';

export interface IntegrationsSectionProps extends SettingsSectionContext {
  onIntegrationSettingsSaved?: () => void;
  attention?: SettingsAttention[];
  onConnectSpotify?: () => Promise<{ ok: boolean; error?: string }>;
  onSettingsErrorChange?: (hasError: boolean) => void;
}

export function IntegrationsSection({
  settings,
  onUpdateSettings,
  t,
  onIntegrationSettingsSaved,
  attention = [],
  onConnectSpotify,
  onSettingsErrorChange,
}: IntegrationsSectionProps) {
  const serverBacked = Boolean(getRuntimeConfig());
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationSettingsStatus | null>(
    null,
  );
  const [integrationStatusLoading, setIntegrationStatusLoading] = useState(serverBacked);
  const [openMeteoUrl, setOpenMeteoUrl] = useState('');
  const [weatherApiUrl, setWeatherApiUrl] = useState('');
  const [weatherApiKey, setWeatherApiKey] = useState('');
  const [weatherApiKeyMode, setWeatherApiKeyMode] = useState<WeatherApiKeyMode>('query');
  const [weatherApiKeyParameter, setWeatherApiKeyParameter] = useState('apikey');
  const [weatherDataMapping, setWeatherDataMapping] = useState<WeatherDataMapping>(
    DEFAULT_WEATHER_DATA_MAPPING,
  );
  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyClientSecret, setSpotifyClientSecret] = useState('');
  const [spotifyMarket, setSpotifyMarket] = useState('NL');
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState('');
  const [mealSourceUrl, setMealSourceUrl] = useState('');
  const [mealSourceToken, setMealSourceToken] = useState('');
  const [mealDataMapping, setMealDataMapping] = useState<MealDataMapping>(EMPTY_MEAL_DATA_MAPPING);
  const [icloudAppleId, setIcloudAppleId] = useState('');
  const [icloudPassword, setIcloudPassword] = useState('');
  const [icloudRemindersListKey, setIcloudRemindersListKey] = useState('');
  const [icloudLists, setIcloudLists] = useState<ICloudRemindersListOption[]>([]);
  const [icloudListsLoaded, setIcloudListsLoaded] = useState(false);
  const [icloudListsAttempted, setIcloudListsAttempted] = useState(false);
  const [icloudListsLoading, setIcloudListsLoading] = useState(false);
  const [icloudCode, setIcloudCode] = useState('');
  const [icloudAuthState, setIcloudAuthState] = useState('');
  const [icloudSecurityKeys, setIcloudSecurityKeys] = useState<string[]>([]);
  const [icloudDevices, setIcloudDevices] = useState<Array<{ index: number; name: string }>>([]);
  const [icloudDeviceIndex, setIcloudDeviceIndex] = useState(0);
  const [icloudPreview, setIcloudPreview] = useState('');
  const [icloudPreviewCopied, setIcloudPreviewCopied] = useState(false);
  const [calendarSources, setCalendarSources] = useState<CalendarSourceSetting[]>([]);
  const [expandedCalendarSourceIds, setExpandedCalendarSourceIds] = useState<string[]>([]);
  const [calendarTestResults, setCalendarTestResults] = useState<Record<string, string[]>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarTestingSourceId, setCalendarTestingSourceId] = useState<string | null>(null);
  const [mealSaving, setMealSaving] = useState(false);
  const [icloudSaving, setIcloudSaving] = useState(false);
  const [icloudBusyAction, setIcloudBusyAction] = useState<
    'authenticate' | 'request_code' | 'verify_code' | 'fetch_preview' | null
  >(null);
  const [weatherTesting, setWeatherTesting] = useState(false);
  const integrationBusy =
    settingsSaving ||
    calendarSaving ||
    calendarTestingSourceId !== null ||
    mealSaving ||
    icloudSaving ||
    icloudBusyAction !== null ||
    weatherTesting;
  const [integrationError, setIntegrationError] = useState('');
  const [integrationNotice, setIntegrationNotice] = useState('');
  const [weatherTestError, setWeatherTestError] = useState('');
  const [weatherTestNotice, setWeatherTestNotice] = useState('');
  const hasAttention = (field: string) => attention.some((item) => item.field === field);
  const hasGroupAttention = (group: SettingsAttention['group']) =>
    attention.some((item) => item.group === group);

  const connectSpotify = async () => {
    setIntegrationError('');
    const result = await onConnectSpotify?.();
    if (result && !result.ok) {
      setIntegrationError(result.error || t('music.spotifyPlaylistConnectFailed'));
    }
  };

  useEffect(() => {
    onSettingsErrorChange?.(Boolean(integrationError || weatherTestError));
  }, [integrationError, onSettingsErrorChange, weatherTestError]);

  const loadIcloudLists = useCallback(async () => {
    setIcloudListsAttempted(true);
    setIcloudListsLoading(true);
    setIntegrationError('');
    try {
      const result = await loadICloudRemindersLists();
      setIcloudLists(result.lists || []);
      setIcloudListsLoaded(true);
    } catch (error) {
      setIcloudListsLoaded(false);
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
    } finally {
      setIcloudListsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!serverBacked) return;
    let cancelled = false;
    loadIntegrationSettings()
      .then((status) => {
        if (cancelled) return;
        setIntegrationStatus(status);
        setOpenMeteoUrl(status.openMeteoUrl);
        setWeatherApiUrl(status.weatherApiUrl);
        setWeatherApiKeyMode(status.weatherApiKeyMode);
        setWeatherApiKeyParameter(status.weatherApiKeyParameter);
        setWeatherDataMapping({ ...DEFAULT_WEATHER_DATA_MAPPING, ...status.weatherDataMapping });
        setSpotifyClientId(status.spotifyClientId);
        setSpotifyMarket(status.spotifyMarket);
        setSpotifyRedirectUri(status.spotifyRedirectUri);
        setMealSourceUrl(status.mealSourceUrl);
        setMealDataMapping({ ...EMPTY_MEAL_DATA_MAPPING, ...status.mealDataMapping });
        setIcloudAppleId(status.icloudAppleId);
        setIcloudRemindersListKey(status.icloudRemindersListKey);
        setIcloudAuthState(status.icloudAuthState);
        setIcloudDevices(status.icloudDevices);
        setIcloudDeviceIndex(status.icloudDevices[0]?.index ?? 0);
        setIcloudSecurityKeys(status.icloudSecurityKeyNames);
        setCalendarSources(status.calendarSources);
        if (['authenticated', 'verified_untrusted', 'fetched'].includes(status.icloudAuthState)) {
          setIntegrationNotice(t('settings.integrations.icloudAuthenticated'));
        } else if (status.icloudAuthState === 'verification_required') {
          setIntegrationNotice(t('settings.integrations.icloudVerificationSent'));
        } else if (status.icloudAuthState === 'security_key_required') {
          setIntegrationNotice(t('settings.integrations.icloudSecurityKeyRequired'));
        } else if (status.icloudAuthState === 'device_selection_required') {
          setIntegrationNotice(t('settings.integrations.icloudChooseDevice'));
        } else if (status.icloudAuthState === 'authenticating') {
          setIntegrationNotice(t('settings.integrations.icloudAuthenticating'));
        }
        if (
          status.icloudAuthState === 'disconnected' &&
          status.icloudPasswordConfigured &&
          status.icloudAppleId
        ) {
          setIcloudAuthState('authenticating');
          setIntegrationNotice(t('settings.integrations.icloudAuthenticating'));
          void authenticateICloudReminders()
            .then((result) => {
              if (cancelled) return;
              setIcloudAuthState(result.state);
              setIcloudDevices(result.devices || []);
              setIcloudDeviceIndex(result.devices?.[0]?.index ?? 0);
              setIcloudSecurityKeys(result.securityKeyNames || []);
              setIntegrationNotice(
                result.state === 'verification_required'
                  ? t('settings.integrations.icloudVerificationSent')
                  : result.state === 'device_selection_required'
                    ? t('settings.integrations.icloudChooseDevice')
                    : result.state === 'security_key_required'
                      ? t('settings.integrations.icloudSecurityKeyRequired')
                      : result.state === 'authenticated' || result.state === 'verified_untrusted'
                        ? t('settings.integrations.icloudAuthenticated')
                        : '',
              );
            })
            .catch((error: unknown) => {
              if (cancelled) return;
              setIcloudAuthState('disconnected');
              setIntegrationError(
                error instanceof Error ? error.message : t('settings.integrations.saveError'),
              );
            });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setIntegrationError(
            error instanceof Error ? error.message : t('settings.integrations.saveError'),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIntegrationStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverBacked, t]);

  useEffect(() => {
    if (!serverBacked || icloudAuthState !== 'authenticating') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshStatus = async () => {
      try {
        const status = await loadIntegrationSettings();
        if (cancelled) return;
        if (status.icloudAuthState !== 'authenticating') {
          setIntegrationStatus(status);
          setIcloudRemindersListKey(status.icloudRemindersListKey);
          setIcloudAuthState(status.icloudAuthState);
          setIcloudDevices(status.icloudDevices);
          setIcloudDeviceIndex(status.icloudDevices[0]?.index ?? 0);
          setIcloudSecurityKeys(status.icloudSecurityKeyNames);
          if (['authenticated', 'verified_untrusted', 'fetched'].includes(status.icloudAuthState)) {
            setIntegrationNotice(t('settings.integrations.icloudAuthenticated'));
          } else if (status.icloudAuthState === 'verification_required') {
            setIntegrationNotice(t('settings.integrations.icloudVerificationSent'));
          } else if (status.icloudAuthState === 'security_key_required') {
            setIntegrationNotice(t('settings.integrations.icloudSecurityKeyRequired'));
          } else if (status.icloudAuthState === 'device_selection_required') {
            setIntegrationNotice(t('settings.integrations.icloudChooseDevice'));
          } else {
            setIntegrationNotice('');
          }
          return;
        }
      } catch {
        // Keep checking while the server completes its automatic login attempt.
      }
      if (!cancelled) timer = setTimeout(() => void refreshStatus(), 1500);
    };
    timer = setTimeout(() => void refreshStatus(), 1200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [serverBacked, icloudAuthState, t]);

  useEffect(() => {
    if (
      !serverBacked ||
      icloudListsAttempted ||
      icloudListsLoaded ||
      icloudListsLoading ||
      !['authenticated', 'verified_untrusted', 'fetched'].includes(icloudAuthState)
    ) {
      return;
    }
    void loadIcloudLists();
  }, [
    serverBacked,
    icloudAuthState,
    icloudListsAttempted,
    icloudListsLoaded,
    icloudListsLoading,
    loadIcloudLists,
  ]);

  const testWeather = async () => {
    setWeatherTesting(true);
    setWeatherTestError('');
    setWeatherTestNotice('');
    try {
      const result = await testWeatherConfiguration({
        openMeteoUrl,
        weatherApiUrl,
        apiKey: weatherApiKey.trim(),
        weatherApiKeyMode,
        weatherApiKeyParameter,
        weatherDataMapping,
      });
      setWeatherTestNotice(result.fallbackUsed
        ? t('settings.integrations.weatherTestFallback', {
            source: result.sourceName,
            days: result.forecastDays,
            reason: result.primaryError || '',
          })
        : t('settings.integrations.weatherTestSuccess', {
            source: result.sourceName,
            days: result.forecastDays,
          }));
    } catch (error) {
      setWeatherTestError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
    } finally {
      setWeatherTesting(false);
    }
  };

  const saveServerIntegrations = async (
    context: 'settings' | 'calendar' | 'meal' | 'icloud' = 'settings',
  ): Promise<boolean> => {
    const resetIcloudSession =
      Boolean(icloudPassword) ||
      (integrationStatus && integrationStatus.icloudAppleId !== icloudAppleId.trim());
    const setSaving = {
      settings: setSettingsSaving,
      calendar: setCalendarSaving,
      meal: setMealSaving,
      icloud: setIcloudSaving,
    }[context];
    setSaving(true);
    setIntegrationError('');
    setIntegrationNotice('');
    try {
      const status = await saveIntegrationSettings({
        openMeteoUrl,
        weatherApiUrl,
        ...(weatherApiKey.trim() ? { weatherApiKey: weatherApiKey.trim() } : {}),
        weatherApiKeyMode,
        weatherApiKeyParameter,
        weatherDataMapping,
        spotifyClientId,
        ...(spotifyClientSecret.trim() ? { spotifyClientSecret: spotifyClientSecret.trim() } : {}),
        spotifyMarket: spotifyMarket.trim().toUpperCase(),
        spotifyRedirectUri,
        mealSourceUrl,
        ...(mealSourceToken.trim() ? { mealSourceToken: mealSourceToken.trim() } : {}),
        mealDataMapping,
        icloudAppleId: icloudAppleId.trim(),
        ...(icloudPassword ? { icloudPassword } : {}),
        icloudRemindersListKey,
        calendarSources,
      });
      setIntegrationStatus(status);
      setOpenMeteoUrl(status.openMeteoUrl);
      setWeatherApiUrl(status.weatherApiUrl);
      setWeatherApiKeyMode(status.weatherApiKeyMode);
      setWeatherApiKeyParameter(status.weatherApiKeyParameter);
      setWeatherDataMapping({ ...DEFAULT_WEATHER_DATA_MAPPING, ...status.weatherDataMapping });
      setCalendarSources(status.calendarSources);
      if (context === 'calendar') setExpandedCalendarSourceIds([]);
      setIcloudRemindersListKey(status.icloudRemindersListKey);
      setIcloudAuthState(status.icloudAuthState);
      setIcloudDevices(status.icloudDevices);
      setIcloudSecurityKeys(status.icloudSecurityKeyNames);
      setWeatherApiKey('');
      setSpotifyClientSecret('');
      setMealSourceToken('');
      setIcloudPassword('');
      if (resetIcloudSession) {
        setIcloudCode('');
        setIcloudPreview('');
        setIcloudLists([]);
        setIcloudListsLoaded(false);
        setIcloudListsAttempted(false);
      }
      setIntegrationNotice(t('settings.integrations.saved'));
      onIntegrationSettingsSaved?.();
      return true;
    } catch (error) {
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const selectIcloudRemindersList = async (listKey: string) => {
    setIcloudRemindersListKey(listKey);
    setIcloudPreview('');
    setIcloudPreviewCopied(false);
    setIcloudSaving(true);
    setIntegrationError('');
    setIntegrationNotice('');
    try {
      const status = await saveIntegrationSettings({ icloudRemindersListKey: listKey });
      setIntegrationStatus(status);
      setIcloudRemindersListKey(status.icloudRemindersListKey);
      setIntegrationNotice(t('settings.integrations.icloudListSaved'));
    } catch (error) {
      setIcloudRemindersListKey(integrationStatus?.icloudRemindersListKey || '');
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
    } finally {
      setIcloudSaving(false);
    }
  };

  const applyIcloudAction = (result: {
    state: string;
    devices?: Array<{ index: number; name: string }>;
    securityKeyNames?: string[];
    decodedAppleSample?: unknown;
  }) => {
    setIcloudAuthState(result.state);
    setIcloudSecurityKeys(result.securityKeyNames || []);
    if (result.devices) {
      setIcloudDevices(result.devices);
      setIcloudDeviceIndex(result.devices[0]?.index ?? 0);
    }
    if (result.state === 'fetched') {
      setIcloudPreview(JSON.stringify(result, null, 2));
      setIcloudPreviewCopied(false);
      setIntegrationNotice(t('settings.integrations.icloudDataRetrieved'));
    } else if (result.state === 'verification_required') {
      setIntegrationNotice(t('settings.integrations.icloudVerificationSent'));
    } else if (result.state === 'authenticated') {
      setIntegrationNotice(t('settings.integrations.icloudAuthenticated'));
    } else if (result.state === 'verified_untrusted') {
      setIntegrationNotice(t('settings.integrations.icloudVerifiedUntrusted'));
    } else if (result.state === 'security_key_required') {
      setIntegrationNotice(t('settings.integrations.icloudSecurityKeyRequired'));
    } else if (result.state === 'device_selection_required') {
      setIntegrationNotice(t('settings.integrations.icloudChooseDevice'));
    }
  };

  const runIcloudAction = async (
    actionType: 'authenticate' | 'request_code' | 'verify_code' | 'fetch_preview',
    action: () => Promise<{
      state: string;
      devices?: Array<{ index: number; name: string }>;
      securityKeyNames?: string[];
      decodedAppleSample?: unknown;
    }>,
  ) => {
    setIcloudBusyAction(actionType);
    setIntegrationError('');
    setIntegrationNotice('');
    try {
      applyIcloudAction(await action());
      onIntegrationSettingsSaved?.();
    } catch (error) {
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
      onIntegrationSettingsSaved?.();
    } finally {
      setIcloudBusyAction(null);
    }
  };

  const copyIcloudPreview = async () => {
    setIntegrationError('');
    try {
      if (await copyText(icloudPreview)) {
        setIcloudPreviewCopied(true);
      } else {
        setIntegrationError(t('settings.integrations.icloudCopyFailed'));
      }
    } catch {
      setIntegrationError(t('settings.integrations.icloudCopyFailed'));
    }
  };

  const authenticateIcloud = async () => {
    if (!(await saveServerIntegrations('icloud'))) return;
    setIcloudPreview('');
    setIcloudCode('');
    await runIcloudAction('authenticate', authenticateICloudReminders);
  };

  const addCalendarSource = () => {
    const id = `calendar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setCalendarSources((sources) => [
      ...sources,
      {
        id,
        name: '',
        provider: 'caldav',
        url: '',
        username: '',
        clientId: '',
      },
    ]);
    setExpandedCalendarSourceIds((ids) => [...ids, id]);
  };

  const updateCalendarSource = (id: string, patch: Partial<CalendarSourceSetting>) => {
    setCalendarSources((sources) =>
      sources.map((source) => (source.id === id ? { ...source, ...patch } : source)),
    );
    setCalendarTestResults((results) => {
      if (!(id in results)) return results;
      const next = { ...results };
      delete next[id];
      return next;
    });
  };

  const removeCalendarSource = (id: string) => {
    setCalendarSources((sources) => sources.filter((source) => source.id !== id));
    setExpandedCalendarSourceIds((ids) => ids.filter((sourceId) => sourceId !== id));
    setCalendarTestResults((results) => {
      if (!(id in results)) return results;
      const next = { ...results };
      delete next[id];
      return next;
    });
  };

  const testCalendarSource = async (source: CalendarSourceSetting) => {
    setCalendarTestingSourceId(source.id);
    setIntegrationError('');
    setIntegrationNotice('');
    setCalendarTestResults((results) => {
      if (!(source.id in results)) return results;
      const next = { ...results };
      delete next[source.id];
      return next;
    });
    try {
      const result = await testCalendarSourceApi(source);
      setCalendarTestResults((results) => ({
        ...results,
        [source.id]: result.calendars.map((calendar) => calendar.name),
      }));
      setIntegrationNotice(
        t('settings.integrations.calendarTestSuccess', { count: result.calendarCount }),
      );
    } catch (error) {
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
    } finally {
      setCalendarTestingSourceId(null);
    }
  };

  const removeSavedSecret = async (clearField: ClearSecretField) => {
    const setSaving = clearField === 'clearIcloudPassword' ? setIcloudSaving : setSettingsSaving;
    setSaving(true);
    setIntegrationError('');
    setIntegrationNotice('');
    try {
      const patch = { [clearField]: true } as IntegrationSettingsPatch;
      const status = await saveIntegrationSettings(patch);
      setIntegrationStatus(status);
      if (clearField === 'clearWeatherApiKey') setWeatherApiKey('');
      if (clearField === 'clearIcloudPassword') {
        setIcloudPassword('');
        setIcloudAuthState(status.icloudAuthState);
        setIcloudRemindersListKey(status.icloudRemindersListKey);
        setIcloudPreview('');
        setIcloudPreviewCopied(false);
        setIcloudLists([]);
        setIcloudListsLoaded(false);
        setIcloudListsAttempted(false);
      }
      setIntegrationNotice(t('settings.integrations.secretRemoved'));
      onIntegrationSettingsSaved?.();
    } catch (error) {
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
    } finally {
      setSaving(false);
    }
  };

  const activeIcloudLists = icloudLists.filter((list) => !list.deleted && !list.isGroup);
  const activeIcloudListIds = new Set(activeIcloudLists.map((list) => list.key));
  const configuredGroceryListIds = settings.groceryListIds.filter((id) =>
    activeIcloudListIds.has(id),
  );
  const configuredTaskListIds = (settings.taskListIds ?? []).filter((id) =>
    activeIcloudListIds.has(id),
  );
  const inferredGroceryListIds = activeIcloudLists
    .filter((list) => isProbablyGroceryList(list.title))
    .map((list) => list.key);
  const effectiveGroceryListIds =
    configuredGroceryListIds.length > 0 ? configuredGroceryListIds : inferredGroceryListIds;
  const effectiveTaskListIds =
    configuredTaskListIds.length > 0
      ? configuredTaskListIds
      : activeIcloudLists
          .filter((list) => !effectiveGroceryListIds.includes(list.key))
          .map((list) => list.key);
  const selectedIcloudListAvailable = activeIcloudLists.some(
    (list) => list.key === icloudRemindersListKey,
  );

  return (
    <div className="settings-integrations">
      <h2 className="settings-section-title">
        {t('settings.integrations.title')}
        {hasGroupAttention('transient') && (
          <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
        )}
      </h2>
      <p className="settings-section-desc">{t('settings.integrations.desc')}</p>
      {hasGroupAttention('server') && (
        <div className="settings-row-sublabel" role="alert">
          <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
          {t('settings.integrations.statusUnavailable')}
        </div>
      )}
      {integrationStatusLoading && (
        <LoadingPlaceholder
          label={t('app.connecting')}
          lines={3}
          className="loading-placeholder--compact"
        />
      )}
      {integrationError && (
        <div className="settings-row-sublabel" role="alert">
          {integrationError}
        </div>
      )}
      {integrationNotice && (
        <div className="settings-row-sublabel" role="status">
          {integrationNotice}
        </div>
      )}

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.integrations.weatherTitle')}</div>
        {serverBacked ? (
          <>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.weatherDefaultUrlLabel')}
                </div>
                <div className="settings-row-sublabel">
                  {t('settings.integrations.weatherDefaultUrlHelp')}
                </div>
              </div>
              <input
                type="url"
                className="settings-input settings-input--wide"
                value={openMeteoUrl}
                onChange={(event) => {
                  setOpenMeteoUrl(event.target.value);
                  setWeatherTestError('');
                  setWeatherTestNotice('');
                }}
                placeholder="https://api.open-meteo.com/v1/forecast?latitude=52.37&longitude=4.90"
                autoComplete="url"
              />
            </div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">{t('settings.integrations.weatherUrlLabel')}</div>
                <div className="settings-row-sublabel">{t('settings.integrations.weatherUrlHelp')}</div>
              </div>
              <input
                type="url"
                className="settings-input settings-input--wide"
                value={weatherApiUrl}
                onChange={(event) => {
                  setWeatherApiUrl(event.target.value);
                  setWeatherTestError('');
                  setWeatherTestNotice('');
                }}
                placeholder="https://api.example.com/weather"
                autoComplete="url"
              />
            </div>
            {(weatherApiUrl.trim() || integrationStatus?.weatherApiKeyConfigured) && (
              <>
                <div className="settings-row settings-integration-field">
                  <div>
                    <div className="settings-row-label">{t('settings.integrations.weatherApiKeyLabel')}</div>
                    <div className="settings-row-sublabel">
                      {integrationStatus?.weatherApiKeyConfigured
                        ? t('settings.integrations.secretSaved')
                        : t('settings.integrations.weatherApiKeyHelp')}
                    </div>
                  </div>
                  <SavedSecretControl
                    label={t('settings.integrations.weatherApiKeyLabel')}
                    value={weatherApiKey}
                    onChange={(value) => {
                      setWeatherApiKey(value);
                      setWeatherTestError('');
                      setWeatherTestNotice('');
                    }}
                    configured={Boolean(integrationStatus?.weatherApiKeyConfigured)}
                    disabled={integrationStatusLoading}
                    busy={integrationBusy}
                    removeLabel={t('settings.integrations.clearSecret')}
                    onRemove={
                      integrationStatus?.weatherApiKeyConfigured
                        ? () => void removeSavedSecret('clearWeatherApiKey')
                        : undefined
                    }
                  />
                </div>
                <div className="settings-row settings-integration-field">
                  <div>
                    <div className="settings-row-label">{t('settings.integrations.weatherAuthModeLabel')}</div>
                    <div className="settings-row-sublabel">{t('settings.integrations.weatherAuthModeHelp')}</div>
                  </div>
                  <select
                    className="settings-input"
                    value={weatherApiKeyMode}
                    onChange={(event) => setWeatherApiKeyMode(event.target.value as WeatherApiKeyMode)}
                  >
                    <option value="query">{t('settings.integrations.weatherAuthQuery')}</option>
                    <option value="bearer">{t('settings.integrations.weatherAuthBearer')}</option>
                  </select>
                </div>
                {weatherApiKeyMode === 'query' && (
                  <div className="settings-row settings-integration-field">
                    <div>
                      <div className="settings-row-label">{t('settings.integrations.weatherApiKeyParameterLabel')}</div>
                      <div className="settings-row-sublabel">{t('settings.integrations.weatherApiKeyParameterHelp')}</div>
                    </div>
                    <input
                      className="settings-input"
                      value={weatherApiKeyParameter}
                      onChange={(event) => setWeatherApiKeyParameter(event.target.value)}
                      placeholder="apikey"
                      autoComplete="off"
                    />
                  </div>
                )}
              </>
            )}
            <details className="settings-json-mapping">
              <summary>{t('settings.integrations.weatherMappingTitle')}</summary>
              <p className="settings-row-sublabel settings-integration-help">
                {t('settings.integrations.weatherMappingHelp')}
              </p>
              {WEATHER_MAPPING_GROUPS.map((group) => (
                <section className="settings-weather-mapping-group" key={group.id}>
                  <div className="settings-row-label">{t(group.labelKey)}</div>
                  {WEATHER_MAPPING_FIELDS.filter((field) => field.group === group.id).map((field) => (
                    <div className="settings-row settings-integration-field" key={field.key}>
                      <div className="settings-row-label">
                        {t(field.labelKey)}
                        {[
                          'currentPath', 'currentTemperaturePath', 'currentConditionPath',
                          'forecastPath', 'forecastDatePath', 'forecastConditionPath',
                          'forecastHighPath', 'forecastLowPath', 'hourlyPath',
                          'hourlyDateTimePath', 'hourlyTemperaturePath',
                        ].includes(field.key) ? ' *' : ''}
                      </div>
                      <input
                        className="settings-input settings-input--wide"
                        value={weatherDataMapping[field.key]}
                        onChange={(event) => {
                          setWeatherDataMapping((current) => ({ ...current, [field.key]: event.target.value }));
                          setWeatherTestError('');
                          setWeatherTestNotice('');
                        }}
                        placeholder={field.placeholder}
                        autoComplete="off"
                      />
                    </div>
                  ))}
                </section>
              ))}
            </details>
            <div className="settings-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="settings-btn"
                onClick={() => void testWeather()}
                disabled={integrationBusy || integrationStatusLoading || !openMeteoUrl.trim()}
              >
                {t('settings.integrations.weatherTestButton')}
              </button>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => void saveServerIntegrations()}
                disabled={integrationBusy || integrationStatusLoading}
              >
                {settingsSaving ? t('settings.integrations.saving') : t('settings.integrations.save')}
              </button>
            </div>
            {weatherTestError && (
              <div className="settings-row-sublabel" role="alert">
                {weatherTestError}
              </div>
            )}
            {weatherTestNotice && (
              <div className="settings-row-sublabel" role="status">
                {weatherTestNotice}
              </div>
            )}
          </>
        ) : (
          <div className="settings-row-sublabel" role="status">
            {t('settings.integrations.weatherBackendRequired')}
          </div>
        )}
      </div>

      {serverBacked && (
        <>
          <div className="settings-group">
            <div className="settings-group-title">
              {t('settings.integrations.spotifyTitle')}
              {hasGroupAttention('spotify') && (
                <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
              )}
            </div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.spotifyClientIdLabel')}
                  {hasAttention('spotifyClientId') && (
                    <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
                  )}
                </div>
                <div className="settings-row-sublabel">
                  {t('settings.integrations.spotifyClientHelp')}
                </div>
              </div>
              <input
                className="settings-input settings-input--wide"
                value={spotifyClientId}
                onChange={(event) => setSpotifyClientId(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.spotifyClientSecretLabel')}
                  {hasAttention('spotifyClientSecret') && (
                    <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
                  )}
                </div>
                <div className="settings-row-sublabel">
                  {integrationStatus?.spotifyClientSecretConfigured
                    ? t('settings.integrations.secretSaved')
                    : t('settings.integrations.spotifyClientHelp')}
                </div>
              </div>
              <SavedSecretControl
                label={t('settings.integrations.spotifyClientSecretLabel')}
                value={spotifyClientSecret}
                onChange={setSpotifyClientSecret}
                configured={Boolean(integrationStatus?.spotifyClientSecretConfigured)}
                disabled={integrationStatusLoading}
                busy={integrationBusy}
                removeLabel={t('settings.integrations.clearSecret')}
                onRemove={() => void removeSavedSecret('clearSpotifyClientSecret')}
              />
            </div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.spotifyMarketLabel')}
                </div>
                <div className="settings-row-sublabel">
                  {t('settings.integrations.spotifyMarketHelp')}
                </div>
              </div>
              <input
                className="settings-input"
                maxLength={2}
                value={spotifyMarket}
                onChange={(event) => setSpotifyMarket(event.target.value.toUpperCase())}
              />
            </div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.spotifyRedirectLabel')}
                  {hasAttention('spotifyRedirectUri') && (
                    <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
                  )}
                </div>
                <div className="settings-row-sublabel">
                  {t('settings.integrations.spotifyRedirectHelp')}
                </div>
              </div>
              <input
                type="url"
                className="settings-input settings-input--wide"
                value={spotifyRedirectUri}
                onChange={(event) => setSpotifyRedirectUri(event.target.value)}
                placeholder="https://<host>/abbai-flow/music/oauth/callback"
              />
            </div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.spotifyAccountLabel')}
                  {(hasAttention('spotifyAccount') || hasAttention('spotifyPlayback')) && (
                    <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
                  )}
                </div>
                <div className="settings-row-sublabel">
                  {hasAttention('spotifyPlayback')
                    ? t('settings.integrations.spotifyPlaybackNeedsAuth')
                    : hasAttention('spotifyAccount')
                      ? t('settings.integrations.spotifyAccountNeedsAuth')
                      : t('settings.integrations.spotifyAccountHelp')}
                </div>
              </div>
              <button
                type="button"
                className="settings-btn"
                onClick={() => void connectSpotify()}
                disabled={!onConnectSpotify || integrationBusy || integrationStatusLoading}
              >
                {t('music.spotifyConnectAccount')}
                {(hasAttention('spotifyAccount') || hasAttention('spotifyPlayback')) && (
                  <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
                )}
              </button>
            </div>
            <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => void saveServerIntegrations()}
                disabled={integrationBusy || integrationStatusLoading}
              >
                {settingsSaving
                  ? t('settings.integrations.saving')
                  : t('settings.integrations.save')}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="settings-group">
        <div className="settings-group-title">
          {t('settings.integrations.icloudRemindersTitle')}
          {hasGroupAttention('icloud') && (
            <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
          )}
        </div>
        <p className="settings-row-sublabel settings-integration-help">
          {t('settings.integrations.icloudRemindersSublabel')}
        </p>
        {serverBacked ? (
          <>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.icloudAppleIdLabel')}
                  {hasAttention('icloudAppleId') && (
                    <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
                  )}
                </div>
                <div className="settings-row-sublabel">
                  {t('settings.integrations.icloudAppleIdHelp')}
                </div>
              </div>
              <input
                type="email"
                className="settings-input settings-input--wide"
                value={icloudAppleId}
                onChange={(event) => setIcloudAppleId(event.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.icloudPasswordLabel')}
                  {hasAttention('icloudPassword') && (
                    <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
                  )}
                </div>
                <div className="settings-row-sublabel">
                  {integrationStatus?.icloudPasswordConfigured
                    ? t('settings.integrations.secretSaved')
                    : t('settings.integrations.icloudPasswordHelp')}
                </div>
              </div>
              <SavedSecretControl
                label={t('settings.integrations.icloudPasswordLabel')}
                value={icloudPassword}
                onChange={setIcloudPassword}
                configured={Boolean(integrationStatus?.icloudPasswordConfigured)}
                disabled={integrationStatusLoading}
                busy={integrationBusy}
                removeLabel={t('settings.integrations.clearSecret')}
                onRemove={() => void removeSavedSecret('clearIcloudPassword')}
              />
            </div>
            <div className="settings-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="settings-btn"
                onClick={() => void saveServerIntegrations('icloud')}
                disabled={integrationBusy || integrationStatusLoading}
              >
                {icloudSaving ? t('settings.integrations.saving') : t('settings.integrations.save')}
              </button>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => void authenticateIcloud()}
                disabled={
                  integrationBusy ||
                  integrationStatusLoading ||
                  icloudAuthState === 'authenticating' ||
                  !icloudAppleId.trim() ||
                  (!icloudPassword && !integrationStatus?.icloudPasswordConfigured)
                }
              >
                {icloudSaving
                  ? t('settings.integrations.saving')
                  : icloudBusyAction === 'authenticate' || icloudAuthState === 'authenticating'
                    ? t('settings.integrations.icloudAuthenticating')
                    : t('settings.integrations.icloudAuthenticate')}
                {hasAttention('icloudAuthentication') && (
                  <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
                )}
              </button>
            </div>
            {icloudAuthState === 'device_selection_required' && (
              <div className="settings-row settings-integration-field">
                <div className="settings-row-label">
                  {t('settings.integrations.icloudChooseDevice')}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="settings-input"
                    value={icloudDeviceIndex}
                    onChange={(event) => setIcloudDeviceIndex(Number(event.target.value))}
                  >
                    {icloudDevices.map((device) => (
                      <option key={device.index} value={device.index}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() =>
                      void runIcloudAction('request_code', () =>
                        requestICloudRemindersVerificationCode(icloudDeviceIndex),
                      )
                    }
                    disabled={integrationBusy || icloudDevices.length === 0}
                  >
                    {icloudBusyAction === 'request_code'
                      ? t('settings.integrations.icloudSendingCode')
                      : t('settings.integrations.icloudSendCode')}
                  </button>
                </div>
              </div>
            )}
            {icloudAuthState === 'verification_required' && (
              <div className="settings-row settings-integration-field">
                <div>
                  <div className="settings-row-label">
                    {t('settings.integrations.icloudCodeLabel')}
                  </div>
                  <div className="settings-row-sublabel">
                    {t('settings.integrations.icloudVerificationSent')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="settings-input"
                    value={icloudCode}
                    onChange={(event) => setIcloudCode(event.target.value)}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                  />
                  <button
                    type="button"
                    className="settings-btn settings-btn--primary"
                    onClick={() =>
                      void runIcloudAction('verify_code', () =>
                        verifyICloudRemindersCode(icloudCode),
                      )
                    }
                    disabled={integrationBusy || !icloudCode.trim()}
                  >
                    {icloudBusyAction === 'verify_code'
                      ? t('settings.integrations.icloudVerifying')
                      : t('settings.integrations.icloudVerifyCode')}
                  </button>
                </div>
              </div>
            )}
            {icloudAuthState === 'security_key_required' && (
              <div className="settings-row-sublabel" role="status">
                {t('settings.integrations.icloudSecurityKeyRequired')}
                {icloudSecurityKeys.length ? ` ${icloudSecurityKeys.join(', ')}` : ''}
              </div>
            )}
            {['authenticated', 'verified_untrusted', 'fetched'].includes(icloudAuthState) && (
              <>
                <div className="settings-row settings-integration-field">
                  <div>
                    <div className="settings-row-label">
                      {t('settings.integrations.icloudListLabel')}
                    </div>
                    <div className="settings-row-sublabel">
                      {t('settings.integrations.icloudListHelp')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
                    <select
                      className="settings-input settings-input--wide"
                      style={{ flex: '1 1 220px', minWidth: 0, maxWidth: '100%' }}
                      value={icloudRemindersListKey}
                      onChange={(event) => void selectIcloudRemindersList(event.target.value)}
                      disabled={integrationBusy || icloudListsLoading}
                    >
                      <option value="">
                        {icloudListsLoading
                          ? t('settings.integrations.icloudListsLoading')
                          : t('settings.integrations.icloudSelectList')}
                      </option>
                      {icloudRemindersListKey && !selectedIcloudListAvailable && (
                        <option value={icloudRemindersListKey} disabled>
                          {t('settings.integrations.icloudSelectedListUnavailable')}
                        </option>
                      )}
                      {activeIcloudLists.map((list) => (
                        <option key={list.key} value={list.key}>
                          {list.title}
                          {list.scope !== 'private' ? ` · ${list.scope}` : ''}
                          {list.count !== null ? ` (${list.count})` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => void loadIcloudLists()}
                      disabled={integrationBusy || icloudListsLoading}
                    >
                      {icloudListsLoading
                        ? t('settings.integrations.icloudListsLoading')
                        : t('settings.integrations.icloudReloadLists')}
                    </button>
                  </div>
                </div>
                {icloudListsLoaded && activeIcloudLists.length === 0 && (
                  <div className="settings-row-sublabel" role="status">
                    {t('settings.integrations.icloudNoLists')}
                  </div>
                )}
                <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() =>
                      void runIcloudAction('fetch_preview', () =>
                        fetchICloudRemindersPreview(icloudRemindersListKey),
                      )
                    }
                    disabled={
                      integrationBusy ||
                      icloudListsLoading ||
                      !icloudRemindersListKey ||
                      !selectedIcloudListAvailable
                    }
                  >
                    {icloudBusyAction === 'fetch_preview'
                      ? t('settings.integrations.icloudFetchingPreview')
                      : t('settings.integrations.icloudFetchPreview')}
                  </button>
                </div>
              </>
            )}
            {icloudPreview && (
              <>
                <div className="settings-row" style={{ justifyContent: 'space-between' }}>
                  <div className="settings-row-label">
                    {t('settings.integrations.icloudPreviewLabel')}
                  </div>
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() => void copyIcloudPreview()}
                    aria-label={
                      icloudPreviewCopied
                        ? t('settings.integrations.icloudResponseCopied')
                        : t('settings.integrations.icloudCopyResponse')
                    }
                  >
                    {icloudPreviewCopied ? (
                      <Check size={16} aria-hidden="true" />
                    ) : (
                      <Copy size={16} aria-hidden="true" />
                    )}
                    <span>
                      {icloudPreviewCopied
                        ? t('settings.integrations.icloudResponseCopied')
                        : t('settings.integrations.icloudCopyResponse')}
                    </span>
                  </button>
                </div>
                <pre
                  aria-label={t('settings.integrations.icloudPreviewLabel')}
                  style={{
                    maxHeight: 360,
                    overflow: 'auto',
                    padding: 12,
                    borderRadius: 8,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    fontSize: '0.78rem',
                  }}
                >
                  {icloudPreview}
                </pre>
              </>
            )}
          </>
        ) : (
          <p className="settings-row-sublabel settings-integration-help">
            {t('settings.integrations.icloudBackendRequired')}
          </p>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-group-title">
          {t('settings.integrations.calendarSourcesTitle')}
          {hasGroupAttention('calendar') && (
            <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
          )}
        </div>
        <p className="settings-row-sublabel settings-integration-help">
          {t('settings.integrations.calendarSourcesHelp')}
        </p>
        {serverBacked &&
          calendarSources.map((source) => {
            const expanded = expandedCalendarSourceIds.includes(source.id);
            const testedCalendars = calendarTestResults[source.id];
            return (
              <details
                key={source.id}
                className="settings-calendar-source"
                open={expanded}
                onToggle={(event) => {
                  const isOpen = event.currentTarget.open;
                  setExpandedCalendarSourceIds((ids) =>
                    isOpen
                      ? ids.includes(source.id)
                        ? ids
                        : [...ids, source.id]
                      : ids.filter((id) => id !== source.id),
                  );
                }}
              >
                <summary className="settings-calendar-source__summary">
                  {source.name.trim() || t('settings.integrations.calendarAddSource')}
                  {hasAttention(`calendarSource:${source.id}`) && (
                    <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
                  )}
                </summary>
                <div className="settings-calendar-source__content">
                  <div className="settings-row settings-integration-field">
                    <div className="settings-row-label">
                      {t('settings.integrations.calendarNameLabel')}
                    </div>
                    <input
                      className="settings-input settings-input--wide"
                      value={source.name}
                      onChange={(event) =>
                        updateCalendarSource(source.id, { name: event.target.value })
                      }
                    />
                  </div>
                  <div className="settings-row settings-integration-field">
                    <div className="settings-row-label">
                      {t('settings.integrations.calendarProviderLabel')}
                    </div>
                    <select
                      className="settings-input"
                      value={source.provider}
                      onChange={(event) =>
                        updateCalendarSource(source.id, {
                          provider: event.target.value as CalendarSourceSetting['provider'],
                        })
                      }
                    >
                      <option value="caldav">
                        {t('settings.integrations.calendarProviderCaldav')}
                      </option>
                      <option value="ics">{t('settings.integrations.calendarProviderIcs')}</option>
                      <option value="google">
                        {t('settings.integrations.calendarProviderGoogle')}
                      </option>
                    </select>
                  </div>
                  <div className="settings-row settings-integration-field">
                    <div className="settings-row-label">
                      {source.provider === 'ics'
                        ? t('settings.integrations.calendarFeedUrlLabel')
                        : t('settings.integrations.calendarServerUrlLabel')}
                      {hasAttention(`calendarSource:${source.id}`) && (
                        <SettingsErrorBadge label={t('settings.integrations.needsAttention')} />
                      )}
                    </div>
                    <input
                      type="url"
                      className="settings-input settings-input--wide"
                      value={source.url}
                      onChange={(event) =>
                        updateCalendarSource(source.id, { url: event.target.value })
                      }
                      placeholder={
                        source.provider === 'ics'
                          ? 'https://school.example/calendar.ics'
                          : source.provider === 'caldav'
                            ? 'https://caldav.icloud.com/'
                            : 'https://caldav.example.com/'
                      }
                    />
                  </div>
                  {source.provider === 'caldav' && (
                    <>
                      <div className="settings-row settings-integration-field">
                        <div className="settings-row-label">
                          {t('settings.integrations.calendarUsernameLabel')}
                        </div>
                        <input
                          className="settings-input settings-input--wide"
                          value={source.username}
                          onChange={(event) =>
                            updateCalendarSource(source.id, { username: event.target.value })
                          }
                          autoComplete="username"
                        />
                      </div>
                      <div className="settings-row settings-integration-field">
                        <div className="settings-row-label">
                          {t('settings.integrations.calendarPasswordLabel')}
                        </div>
                        <SavedSecretControl
                          label={t('settings.integrations.calendarPasswordLabel')}
                          value={source.password || ''}
                          onChange={(password) =>
                            updateCalendarSource(source.id, { password, clearPassword: false })
                          }
                          configured={Boolean(source.passwordConfigured)}
                          disabled={integrationStatusLoading}
                          busy={integrationBusy}
                          removeLabel={t('settings.integrations.clearSecret')}
                          onRemove={() =>
                            updateCalendarSource(source.id, {
                              password: '',
                              passwordConfigured: false,
                              clearPassword: true,
                            })
                          }
                        />
                      </div>
                    </>
                  )}
                  {source.provider === 'google' && (
                    <>
                      <div className="settings-row settings-integration-field">
                        <div className="settings-row-label">
                          {t('settings.integrations.calendarClientIdLabel')}
                        </div>
                        <input
                          className="settings-input settings-input--wide"
                          value={source.clientId}
                          onChange={(event) =>
                            updateCalendarSource(source.id, { clientId: event.target.value })
                          }
                          autoComplete="off"
                        />
                      </div>
                      <div className="settings-row settings-integration-field">
                        <div className="settings-row-label">
                          {t('settings.integrations.calendarClientSecretLabel')}
                        </div>
                        <SavedSecretControl
                          label={t('settings.integrations.calendarClientSecretLabel')}
                          value={source.clientSecret || ''}
                          onChange={(clientSecret) =>
                            updateCalendarSource(source.id, {
                              clientSecret,
                              clearClientSecret: false,
                            })
                          }
                          configured={Boolean(source.clientSecretConfigured)}
                          disabled={integrationStatusLoading}
                          busy={integrationBusy}
                          removeLabel={t('settings.integrations.clearSecret')}
                          onRemove={() =>
                            updateCalendarSource(source.id, {
                              clientSecret: '',
                              clientSecretConfigured: false,
                              clearClientSecret: true,
                            })
                          }
                        />
                      </div>
                    </>
                  )}
                  <div className="settings-row-sublabel">
                    {source.provider === 'caldav'
                      ? t('settings.integrations.calendarCaldavHelp')
                      : source.provider === 'ics'
                        ? t('settings.integrations.calendarIcsHelp')
                        : t('settings.integrations.calendarCredentialsOnly')}
                  </div>
                  {testedCalendars && (
                    <div
                      className="settings-calendar-test-results"
                      role="status"
                      aria-live="polite"
                    >
                      <div>
                        {t('settings.integrations.calendarTestSuccess', {
                          count: testedCalendars.length,
                        })}
                      </div>
                      {testedCalendars.length > 0 && (
                        <ul>
                          {testedCalendars.map((name, index) => (
                            <li key={`${name}-${index}`}>{name}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
                    {(source.provider === 'caldav' || source.provider === 'ics') && (
                      <button
                        type="button"
                        className="settings-btn"
                        onClick={() => void testCalendarSource(source)}
                        disabled={
                          integrationBusy ||
                          integrationStatusLoading ||
                          !source.url.trim() ||
                          (source.provider === 'caldav' &&
                            (!source.username.trim() ||
                              !(source.password?.trim() || source.passwordConfigured)))
                        }
                      >
                        {calendarTestingSourceId === source.id
                          ? t('settings.integrations.calendarTesting')
                          : t('settings.integrations.calendarTestConnection')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="settings-btn settings-btn--danger"
                      onClick={() => removeCalendarSource(source.id)}
                    >
                      {t('settings.integrations.calendarRemoveSource')}
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
        {serverBacked && (
          <div className="settings-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="settings-btn"
              onClick={addCalendarSource}
              disabled={calendarSources.length >= 12}
            >
              {t('settings.integrations.calendarAddSource')}
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={() => void saveServerIntegrations('calendar')}
              disabled={integrationBusy || integrationStatusLoading}
            >
              {calendarSaving
                ? t('settings.integrations.calendarSaving')
                : t('settings.integrations.save')}
            </button>
          </div>
        )}
        {!serverBacked && (
          <p className="settings-row-sublabel settings-integration-help">
            {t('settings.integrations.calendarBackendRequired')}
          </p>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.integrations.groceryTitle')}</div>
        <div
          className="settings-row"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
        >
          <div>
            <div className="settings-row-label">{t('settings.integrations.groceryListsLabel')}</div>
            <div className="settings-row-sublabel">
              {t('settings.integrations.groceryListsSublabel')}
            </div>
          </div>
          {icloudListsLoading ? (
            <div className="settings-row-sublabel">
              {t('settings.integrations.icloudListsLoading')}
            </div>
          ) : activeIcloudLists.length === 0 ? (
            <div className="settings-row-sublabel">
              {t('settings.integrations.noICloudListsFound')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {activeIcloudLists.map((list) => {
                const isChecked = effectiveGroceryListIds.includes(list.key);
                return (
                  <label
                    key={list.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: isChecked ? 'var(--bg-today)' : 'var(--bg-surface)',
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        const newIds = e.target.checked
                          ? [...new Set([...effectiveGroceryListIds, list.key])]
                          : effectiveGroceryListIds.filter((id) => id !== list.key);
                        onUpdateSettings({ groceryListIds: newIds });
                      }}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      {list.title}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        {/*
          Task lists are chosen explicitly, the same way grocery lists are.
          Leaving this empty includes every iCloud list not selected as a grocery list.
        */}
        <div
          className="settings-row"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
        >
          <div>
            <div className="settings-row-label">{t('nav.tasks')}</div>
            <div className="settings-row-sublabel">
              {t('settings.integrations.taskListsSublabel')}
            </div>
          </div>
          {icloudListsLoading ? (
            <div className="settings-row-sublabel">
              {t('settings.integrations.icloudListsLoading')}
            </div>
          ) : activeIcloudLists.length === 0 ? (
            <div className="settings-row-sublabel">
              {t('settings.integrations.noICloudListsFound')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {activeIcloudLists.map((list) => {
                const isGrocery = effectiveGroceryListIds.includes(list.key);
                const isChecked = !isGrocery && effectiveTaskListIds.includes(list.key);
                return (
                  <label
                    key={list.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: isChecked ? 'var(--bg-today)' : 'var(--bg-surface)',
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isGrocery}
                      onChange={(e) => {
                        const newIds = e.target.checked
                          ? [...new Set([...effectiveTaskListIds, list.key])]
                          : effectiveTaskListIds.filter((id) => id !== list.key);
                        onUpdateSettings({ taskListIds: newIds });
                      }}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      {list.title}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className="settings-row settings-integration-field">
          <div>
            <div className="settings-row-label">
              {t('settings.integrations.defaultGroceryListLabel')}
            </div>
            <div className="settings-row-sublabel">
              {t('settings.integrations.defaultGroceryListSublabel')}
            </div>
          </div>
          <select
            className="settings-input"
            value={settings.defaultGroceryList}
            onChange={(e) => onUpdateSettings({ defaultGroceryList: e.target.value })}
          >
            <option value="">{t('settings.integrations.autoFirstAvailable')}</option>
            {settings.defaultGroceryList &&
              !activeIcloudListIds.has(settings.defaultGroceryList) && (
                <option value={settings.defaultGroceryList} disabled>
                  {t('settings.integrations.icloudSelectedListUnavailable')}
                </option>
              )}
            {activeIcloudLists.map((list) => (
              <option key={list.key} value={list.key}>
                {list.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.integrations.mealSourceTitle')}</div>
        {serverBacked ? (
          <>
            <p className="settings-row-sublabel settings-integration-help">
              {t('settings.integrations.mealSourceDescription')}
            </p>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.mealSourceUrlLabel')}
                </div>
                <div className="settings-row-sublabel">
                  {t('settings.integrations.mealSourceUrlHelp')}
                </div>
              </div>
              <input
                type="url"
                className="settings-input settings-input--wide"
                value={mealSourceUrl}
                onChange={(event) => setMealSourceUrl(event.target.value)}
                placeholder="https://api.example.com/recipes"
                autoComplete="url"
              />
            </div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.mealSourceTokenLabel')}
                </div>
                <div className="settings-row-sublabel">
                  {integrationStatus?.mealSourceTokenConfigured
                    ? t('settings.integrations.secretSaved')
                    : t('settings.integrations.mealSourceTokenHelp')}
                </div>
              </div>
              <SavedSecretControl
                label={t('settings.integrations.mealSourceTokenLabel')}
                value={mealSourceToken}
                onChange={setMealSourceToken}
                configured={Boolean(integrationStatus?.mealSourceTokenConfigured)}
                disabled={integrationStatusLoading}
                busy={integrationBusy}
                removeLabel={t('settings.integrations.clearSecret')}
                onRemove={() => void removeSavedSecret('clearMealSourceToken')}
              />
            </div>
            <details className="settings-json-mapping">
              <summary>{t('settings.integrations.mealMappingTitle')}</summary>
              <p className="settings-row-sublabel settings-integration-help">
                {t('settings.integrations.mealSourceMappingHelp')}
              </p>
              {MEAL_MAPPING_FIELDS.map((field) => (
                <div className="settings-row settings-integration-field" key={field.key}>
                  <div className="settings-row-label">
                    {t(field.labelKey)}
                    {['itemsPath', 'titlePath', 'stepsPath'].includes(field.key) ? ' *' : ''}
                  </div>
                  <input
                    className="settings-input settings-input--wide"
                    value={mealDataMapping[field.key]}
                    onChange={(event) =>
                      setMealDataMapping((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                    autoComplete="off"
                  />
                </div>
              ))}
            </details>
            <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => void saveServerIntegrations('meal')}
                disabled={integrationBusy || integrationStatusLoading}
              >
                {mealSaving ? t('settings.integrations.saving') : t('settings.integrations.save')}
              </button>
            </div>
          </>
        ) : (
          <p className="settings-row-sublabel settings-integration-help">
            {t('settings.integrations.mealSourceBackendRequired')}
          </p>
        )}
      </div>
    </div>
  );
}
