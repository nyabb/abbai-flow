/**
 * Integrations settings: Home Assistant connection status, iCloud Reminders,
 * grocery lists, Music Assistant and the photo slideshow options.
 *
 * The todo-list lookup only feeds these controls, so the fetch lives here.
 */
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { HomeAssistantTodoClient } from '../../../api/home-assistant-todo';
import {
  loadIntegrationSettings,
  saveIntegrationSettings,
  testHomeAssistantConnection,
  type IntegrationSettingsPatch,
  type MealDataMapping,
  type IntegrationSettingsStatus,
} from '../../../api/integration-settings';
import { hasToken } from '../../../api/ha-rest';
import { getRuntimeConfig } from '../../../config';
import type { TranslationKey } from '../../../i18n';
import type { GroceryList } from '../../../types/grocery';
import { LoadingPlaceholder } from '../../LoadingPlaceholder';
import { SecretInput } from '../SecretInput';
import { Segment, Slider } from '../controls';
import type { SettingsSectionContext } from './context';

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
  | 'clearHaToken'
  | 'clearEncoreToken'
  | 'clearSpotifyClientSecret'
  | 'clearMealSourceToken';

export interface IntegrationsSectionProps extends SettingsSectionContext {
  connected: boolean;
  haUrl: string;
  haTokenConfigured?: boolean;
  onSaveHomeAssistant?: (url: string, token: string) => Promise<void>;
  onRemoveHomeAssistantToken?: () => Promise<void>;
  onIntegrationSettingsSaved?: () => void;
}

export function IntegrationsSection({
  settings,
  onUpdateSettings,
  t,
  connected,
  haUrl: initialHaUrl,
  haTokenConfigured,
  onSaveHomeAssistant,
  onRemoveHomeAssistantToken,
  onIntegrationSettingsSaved,
}: IntegrationsSectionProps) {
  const [todoLists, setTodoLists] = useState<GroceryList[]>([]);
  const serverBacked = Boolean(getRuntimeConfig());
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationSettingsStatus | null>(
    null,
  );
  const [integrationStatusLoading, setIntegrationStatusLoading] = useState(serverBacked);
  const [haUrl, setHaUrl] = useState(initialHaUrl);
  const [haToken, setHaToken] = useState('');
  const [encoreUrl, setEncoreUrl] = useState('ws://host.docker.internal:8095/');
  const [encoreToken, setEncoreToken] = useState('');
  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyClientSecret, setSpotifyClientSecret] = useState('');
  const [spotifyMarket, setSpotifyMarket] = useState('NL');
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState('');
  const [mealSourceUrl, setMealSourceUrl] = useState('');
  const [mealSourceToken, setMealSourceToken] = useState('');
  const [mealDataMapping, setMealDataMapping] = useState<MealDataMapping>(EMPTY_MEAL_DATA_MAPPING);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationError, setIntegrationError] = useState('');
  const [integrationNotice, setIntegrationNotice] = useState('');

  useEffect(() => setHaUrl(initialHaUrl), [initialHaUrl]);

  useEffect(() => {
    if (!serverBacked) return;
    let cancelled = false;
    loadIntegrationSettings()
      .then((status) => {
        if (cancelled) return;
        setIntegrationStatus(status);
        setHaUrl(status.haUrl);
        setEncoreUrl(status.encoreUrl);
        setSpotifyClientId(status.spotifyClientId);
        setSpotifyMarket(status.spotifyMarket);
        setSpotifyRedirectUri(status.spotifyRedirectUri);
        setMealSourceUrl(status.mealSourceUrl);
        setMealDataMapping({ ...EMPTY_MEAL_DATA_MAPPING, ...status.mealDataMapping });
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

  const testHa = async () => {
    setIntegrationBusy(true);
    setIntegrationError('');
    setIntegrationNotice('');
    try {
      await testHomeAssistantConnection({
        haUrl,
        ...(haToken.trim() ? { haToken: haToken.trim() } : {}),
      });
      setIntegrationNotice(t('settings.integrations.testSuccess'));
    } catch (error) {
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
    } finally {
      setIntegrationBusy(false);
    }
  };

  const saveServerIntegrations = async () => {
    setIntegrationBusy(true);
    setIntegrationError('');
    setIntegrationNotice('');
    try {
      const status = await saveIntegrationSettings({
        haUrl,
        ...(haToken.trim() ? { haToken: haToken.trim() } : {}),
        encoreUrl,
        ...(encoreToken.trim() ? { encoreToken: encoreToken.trim() } : {}),
        spotifyClientId,
        ...(spotifyClientSecret.trim() ? { spotifyClientSecret: spotifyClientSecret.trim() } : {}),
        spotifyMarket: spotifyMarket.trim().toUpperCase(),
        spotifyRedirectUri,
        mealSourceUrl,
        ...(mealSourceToken.trim() ? { mealSourceToken: mealSourceToken.trim() } : {}),
        mealDataMapping,
      });
      setIntegrationStatus(status);
      setHaToken('');
      setEncoreToken('');
      setSpotifyClientSecret('');
      setMealSourceToken('');
      setIntegrationNotice(t('settings.integrations.saved'));
      onIntegrationSettingsSaved?.();
    } catch (error) {
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
    } finally {
      setIntegrationBusy(false);
    }
  };

  const saveBrowserHomeAssistant = async () => {
    if (!onSaveHomeAssistant) return;
    setIntegrationBusy(true);
    setIntegrationError('');
    setIntegrationNotice('');
    try {
      await onSaveHomeAssistant(haUrl, haToken);
      setHaToken('');
      setIntegrationNotice(t('settings.integrations.saved'));
    } catch (error) {
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
    } finally {
      setIntegrationBusy(false);
    }
  };

  const removeSavedSecret = async (clearField: ClearSecretField) => {
    setIntegrationBusy(true);
    setIntegrationError('');
    setIntegrationNotice('');
    try {
      const patch = { [clearField]: true } as IntegrationSettingsPatch;
      const status = await saveIntegrationSettings(patch);
      setIntegrationStatus(status);
      setIntegrationNotice(t('settings.integrations.secretRemoved'));
      if (clearField === 'clearHaToken') onIntegrationSettingsSaved?.();
    } catch (error) {
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
    } finally {
      setIntegrationBusy(false);
    }
  };

  const haConfigured = serverBacked ? integrationStatus?.haConfigured : connected;
  const haSecretConfigured = serverBacked
    ? Boolean(integrationStatus?.haConfigured)
    : (haTokenConfigured ?? connected);

  useEffect(() => {
    if (!hasToken()) {
      setTodoLists([]);
      return;
    }
    let cancelled = false;
    const client = new HomeAssistantTodoClient();
    client
      .getLists()
      .then((lists) => {
        if (!cancelled) setTodoLists(lists);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connected, integrationStatus?.haConfigured]);

  return (
    <div className="settings-integrations">
      <h2 className="settings-section-title">{t('settings.integrations.title')}</h2>
      <p className="settings-section-desc">{t('settings.integrations.desc')}</p>
      {integrationStatusLoading && (
        <LoadingPlaceholder
          label={t('app.connecting')}
          lines={3}
          className="loading-placeholder--compact"
        />
      )}

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.integrations.homeAssistantTitle')}</div>
        <div className="settings-row settings-integration-field">
          <div>
            <div className="settings-row-label">{t('settings.integrations.haUrlLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.integrations.haUrlHelp')}</div>
          </div>
          <input
            type="url"
            className="settings-input settings-input--wide"
            value={haUrl}
            onChange={(event) => setHaUrl(event.target.value)}
            placeholder="http://homeassistant.local:8123"
          />
        </div>
        <div className="settings-row settings-integration-field">
          <div>
            <div className="settings-row-label">{t('settings.integrations.haTokenLabel')}</div>
            <div className="settings-row-sublabel">
              {haConfigured
                ? t('settings.integrations.secretSaved')
                : t('settings.integrations.haTokenHelp')}
            </div>
          </div>
          <SavedSecretControl
            label={t('settings.integrations.haTokenLabel')}
            value={haToken}
            onChange={setHaToken}
            configured={haSecretConfigured}
            disabled={serverBacked && integrationStatusLoading}
            busy={integrationBusy}
            removeLabel={t('settings.integrations.clearSecret')}
            onRemove={
              serverBacked && integrationStatus?.haConfigured
                ? () => void removeSavedSecret('clearHaToken')
                : !serverBacked && haSecretConfigured && onRemoveHomeAssistantToken
                  ? () => void onRemoveHomeAssistantToken()
                  : undefined
            }
          />
        </div>
        <div className="settings-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className={`settings-status-dot ${haConfigured ? 'settings-status-dot--connected' : 'settings-status-dot--disconnected'}`}
            />
            <div>
              <div className="settings-row-label">
                {t('settings.integrations.connectionStatusLabel')}
              </div>
              <div className="settings-row-sublabel">
                {serverBacked
                  ? haConfigured
                    ? t('settings.integrations.configured')
                    : t('settings.integrations.disconnected')
                  : connected
                    ? t('settings.integrations.connected')
                    : t('settings.integrations.disconnected')}{' '}
                &middot; {haUrl || t('settings.integrations.notConfigured')}
              </div>
            </div>
          </div>
        </div>
        {serverBacked ? (
          <div className="settings-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="settings-btn"
              onClick={() => void testHa()}
              disabled={integrationBusy || integrationStatusLoading}
            >
              {t('settings.integrations.testConnection')}
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={() => void saveServerIntegrations()}
              disabled={integrationBusy || integrationStatusLoading}
            >
              {integrationBusy
                ? t('settings.integrations.saving')
                : t('settings.integrations.save')}
            </button>
          </div>
        ) : (
          <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={() => void saveBrowserHomeAssistant()}
              disabled={
                integrationBusy ||
                !onSaveHomeAssistant ||
                !haUrl.trim() ||
                (!haToken.trim() && !connected)
              }
            >
              {t('settings.integrations.save')}
            </button>
          </div>
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
        <div className="settings-row settings-integration-field">
          <div>
            <div className="settings-row-label">
              {t('settings.integrations.weatherEntityLabel')}
            </div>
            <div className="settings-row-sublabel">
              {t('settings.integrations.weatherEntitySublabel')}
            </div>
          </div>
          <input
            type="text"
            className="settings-input"
            value={settings.weatherEntity}
            onChange={(e) => onUpdateSettings({ weatherEntity: e.target.value })}
            placeholder="weather.home"
          />
        </div>
      </div>

      {serverBacked && (
        <>
          <div className="settings-group">
            <div className="settings-group-title">{t('settings.integrations.encoreTitle')}</div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.encoreUrlLabel')}
                </div>
                <div className="settings-row-sublabel">
                  {t('settings.integrations.encoreUrlHelp')}
                </div>
              </div>
              <input
                className="settings-input settings-input--wide"
                value={encoreUrl}
                onChange={(event) => setEncoreUrl(event.target.value)}
                placeholder="ws://host.docker.internal:8095/"
              />
            </div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.encoreTokenLabel')}
                </div>
                <div className="settings-row-sublabel">
                  {integrationStatus?.encoreConfigured
                    ? t('settings.integrations.secretSaved')
                    : t('settings.integrations.encoreTokenHelp')}
                </div>
              </div>
              <SavedSecretControl
                label={t('settings.integrations.encoreTokenLabel')}
                value={encoreToken}
                onChange={setEncoreToken}
                configured={Boolean(integrationStatus?.encoreConfigured)}
                disabled={integrationStatusLoading}
                busy={integrationBusy}
                removeLabel={t('settings.integrations.clearSecret')}
                onRemove={() => void removeSavedSecret('clearEncoreToken')}
              />
            </div>
            <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => void saveServerIntegrations()}
                disabled={integrationBusy || integrationStatusLoading}
              >
                {integrationBusy
                  ? t('settings.integrations.saving')
                  : t('settings.integrations.save')}
              </button>
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-group-title">{t('settings.integrations.spotifyTitle')}</div>
            <div className="settings-row settings-integration-field">
              <div>
                <div className="settings-row-label">
                  {t('settings.integrations.spotifyClientIdLabel')}
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
            <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => void saveServerIntegrations()}
                disabled={integrationBusy || integrationStatusLoading}
              >
                {integrationBusy
                  ? t('settings.integrations.saving')
                  : t('settings.integrations.save')}
              </button>
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-group-title">{t('settings.integrations.mealSourceTitle')}</div>
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
            <div className="settings-row-sublabel settings-integration-help">
              {t('settings.integrations.mealSourceMappingHelp')}
            </div>
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
            <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => void saveServerIntegrations()}
                disabled={integrationBusy || integrationStatusLoading}
              >
                {integrationBusy
                  ? t('settings.integrations.saving')
                  : t('settings.integrations.save')}
              </button>
            </div>
          </div>
        </>
      )}

      {!serverBacked && (
        <div className="settings-group">
          <div className="settings-group-title">{t('settings.integrations.mealSourceTitle')}</div>
          <p className="settings-row-sublabel settings-integration-help">
            {t('settings.integrations.mealSourceBackendRequired')}
          </p>
        </div>
      )}

      <div className="settings-group">
        <div className="settings-group-title">
          {t('settings.integrations.icloudRemindersTitle')}
        </div>
        <p className="settings-row-sublabel settings-integration-help">
          {t('settings.integrations.icloudRemindersSublabel')}
        </p>
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
          {todoLists.length === 0 ? (
            <div className="settings-row-sublabel">
              {t('settings.integrations.noTodoListsFound')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {todoLists.map((list) => {
                const isChecked = settings.groceryListIds.includes(list.id);
                return (
                  <label
                    key={list.id}
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
                          ? [...settings.groceryListIds, list.id]
                          : settings.groceryListIds.filter((id) => id !== list.id);
                        onUpdateSettings({ groceryListIds: newIds });
                      }}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      {list.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        {/*
          Task lists are chosen explicitly, the same way grocery lists are.
          Leaving this empty keeps the old "everything that is not grocery"
          behaviour, but a selection means exactly those entities are read.
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
          {todoLists.length === 0 ? (
            <div className="settings-row-sublabel">
              {t('settings.integrations.noTodoListsFound')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {todoLists.map((list) => {
                const selected = settings.taskListIds ?? [];
                const isChecked = selected.includes(list.id);
                return (
                  <label
                    key={list.id}
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
                          ? [...selected, list.id]
                          : selected.filter((id) => id !== list.id);
                        onUpdateSettings({ taskListIds: newIds });
                      }}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      {list.name}
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
            {todoLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row settings-integration-field">
          <div>
            <div className="settings-row-label">
              {t('settings.integrations.shoppingEntityLabel')}
            </div>
            <div className="settings-row-sublabel">
              {t('settings.integrations.shoppingEntitySublabel')}
            </div>
          </div>
          <select
            className="settings-input"
            value={settings.shoppingEntity}
            onChange={(e) => onUpdateSettings({ shoppingEntity: e.target.value })}
          >
            <option value="">{t('common.none')}</option>
            {todoLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.integrations.musicAssistantTitle')}</div>
        <div className="settings-row settings-integration-field">
          <div>
            <div className="settings-row-label">
              {t('settings.integrations.defaultPlayerLabel')}
            </div>
            <div className="settings-row-sublabel">
              {t('settings.integrations.defaultPlayerSublabel')}
            </div>
          </div>
          <input
            type="text"
            className="settings-input"
            value={settings.musicDefaultPlayer}
            onChange={(e) => onUpdateSettings({ musicDefaultPlayer: e.target.value })}
            placeholder="media_player.living_room"
          />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.integrations.photosTitle')}</div>
        <div className="settings-row settings-integration-field">
          <div>
            <div className="settings-row-label">
              {t('settings.integrations.sourceDirectoryLabel')}
            </div>
            <div className="settings-row-sublabel">
              {t('settings.integrations.sourceDirectorySublabel')}
            </div>
          </div>
          <input
            type="text"
            className="settings-input settings-input--wide"
            value={settings.photoDirectory}
            onChange={(e) => onUpdateSettings({ photoDirectory: e.target.value })}
            placeholder="/media/beacon/photos"
          />
        </div>
        <div className="settings-row settings-integration-field">
          <div>
            <div className="settings-row-label">
              {t('settings.integrations.slideshowIntervalLabel')}
            </div>
            <div className="settings-row-sublabel">
              {t('settings.integrations.slideshowIntervalSublabel')}
            </div>
          </div>
          <Slider
            value={settings.photoInterval}
            min={10}
            max={120}
            step={5}
            unit="s"
            onChange={(v) => onUpdateSettings({ photoInterval: v })}
          />
        </div>
        <div className="settings-row settings-integration-field">
          <div className="settings-row-label">
            {t('settings.integrations.transitionStyleLabel')}
          </div>
          <Segment
            value={settings.photoTransition}
            options={[
              { value: 'fade', label: t('settings.integrations.fade') },
              { value: 'slide', label: t('settings.integrations.slide') },
            ]}
            onChange={(v) => onUpdateSettings({ photoTransition: v })}
          />
        </div>
      </div>
    </div>
  );
}
