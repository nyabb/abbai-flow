/**
 * Integrations settings: Home Assistant connection status, Grocy, AnyList,
 * grocery lists, Music Assistant and the photo slideshow options.
 *
 * The todo-list lookup only feeds these controls, so the fetch lives here.
 */
import { useEffect, useState } from 'react';
import { AnyListClient } from '../../../api/anylist';
import {
  loadIntegrationSettings,
  saveIntegrationSettings,
  testHomeAssistantConnection,
  type MealDataMapping,
  type IntegrationSettingsStatus,
} from '../../../api/integration-settings';
import { getRuntimeConfig } from '../../../config';
import type { TranslationKey } from '../../../i18n';
import type { GroceryList } from '../../../types/grocery';
import { Segment, Slider, Toggle } from '../controls';
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

export interface IntegrationsSectionProps extends SettingsSectionContext {
  connected: boolean;
  haUrl: string;
  onSaveHomeAssistant?: (url: string, token: string) => Promise<void>;
}

export function IntegrationsSection({
  settings,
  onUpdateSettings,
  t,
  connected,
  haUrl: initialHaUrl,
  onSaveHomeAssistant,
}: IntegrationsSectionProps) {
  const [todoLists, setTodoLists] = useState<GroceryList[]>([]);
  const serverBacked = Boolean(getRuntimeConfig());
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationSettingsStatus | null>(
    null,
  );
  const [haUrl, setHaUrl] = useState(initialHaUrl);
  const [haToken, setHaToken] = useState('');
  const [clearHaToken, setClearHaToken] = useState(false);
  const [encoreUrl, setEncoreUrl] = useState('ws://host.docker.internal:8095/');
  const [encoreToken, setEncoreToken] = useState('');
  const [clearEncoreToken, setClearEncoreToken] = useState(false);
  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyClientSecret, setSpotifyClientSecret] = useState('');
  const [clearSpotifyClientSecret, setClearSpotifyClientSecret] = useState(false);
  const [spotifyMarket, setSpotifyMarket] = useState('NL');
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState('');
  const [mealSourceUrl, setMealSourceUrl] = useState('');
  const [mealSourceToken, setMealSourceToken] = useState('');
  const [clearMealSourceToken, setClearMealSourceToken] = useState(false);
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
        ...(clearHaToken ? { clearHaToken: true } : {}),
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
        ...(clearHaToken ? { clearHaToken: true } : {}),
        encoreUrl,
        ...(encoreToken.trim() ? { encoreToken: encoreToken.trim() } : {}),
        ...(clearEncoreToken ? { clearEncoreToken: true } : {}),
        spotifyClientId,
        ...(spotifyClientSecret.trim() ? { spotifyClientSecret: spotifyClientSecret.trim() } : {}),
        ...(clearSpotifyClientSecret ? { clearSpotifyClientSecret: true } : {}),
        spotifyMarket: spotifyMarket.trim().toUpperCase(),
        spotifyRedirectUri,
        mealSourceUrl,
        ...(mealSourceToken.trim() ? { mealSourceToken: mealSourceToken.trim() } : {}),
        ...(clearMealSourceToken ? { clearMealSourceToken: true } : {}),
        mealDataMapping,
      });
      setIntegrationStatus(status);
      setHaToken('');
      setEncoreToken('');
      setSpotifyClientSecret('');
      setMealSourceToken('');
      setClearHaToken(false);
      setClearEncoreToken(false);
      setClearSpotifyClientSecret(false);
      setClearMealSourceToken(false);
      setIntegrationNotice(t('settings.integrations.saved'));
      window.location.reload();
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
    try {
      await onSaveHomeAssistant(haUrl, haToken);
    } catch (error) {
      setIntegrationError(
        error instanceof Error ? error.message : t('settings.integrations.saveError'),
      );
      setIntegrationBusy(false);
    }
  };

  const haConfigured = serverBacked ? integrationStatus?.haConfigured : connected;

  useEffect(() => {
    if (!connected) return;
    const client = new AnyListClient();
    client
      .getLists()
      .then(setTodoLists)
      .catch(() => {});
  }, [connected]);

  return (
    <>
      <h2 className="settings-section-title">{t('settings.integrations.title')}</h2>
      <p className="settings-section-desc">{t('settings.integrations.desc')}</p>

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.integrations.homeAssistantTitle')}</div>
        <div className="settings-row">
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
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.integrations.haTokenLabel')}</div>
            <div className="settings-row-sublabel">
              {haConfigured
                ? t('settings.integrations.secretSaved')
                : t('settings.integrations.haTokenHelp')}
            </div>
          </div>
          <input
            type="password"
            className="settings-input settings-input--wide"
            value={haToken}
            onChange={(event) => setHaToken(event.target.value)}
            placeholder={haConfigured ? t('settings.integrations.secretReplace') : ''}
            autoComplete="new-password"
          />
        </div>
        {serverBacked && integrationStatus?.haConfigured && (
          <label className="settings-row-sublabel">
            <input
              type="checkbox"
              checked={clearHaToken}
              onChange={(event) => setClearHaToken(event.target.checked)}
            />{' '}
            {t('settings.integrations.clearSecret')}
          </label>
        )}
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
              disabled={integrationBusy}
            >
              {t('settings.integrations.testConnection')}
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={() => void saveServerIntegrations()}
              disabled={integrationBusy}
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
        <div className="settings-row">
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
            <div className="settings-row">
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
            <div className="settings-row">
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
              <input
                type="password"
                className="settings-input settings-input--wide"
                value={encoreToken}
                onChange={(event) => setEncoreToken(event.target.value)}
                placeholder={
                  integrationStatus?.encoreConfigured
                    ? t('settings.integrations.secretReplace')
                    : ''
                }
                autoComplete="new-password"
              />
            </div>
            {integrationStatus?.encoreConfigured && (
              <label className="settings-row-sublabel">
                <input
                  type="checkbox"
                  checked={clearEncoreToken}
                  onChange={(event) => setClearEncoreToken(event.target.checked)}
                />{' '}
                {t('settings.integrations.clearSecret')}
              </label>
            )}
          </div>

          <div className="settings-group">
            <div className="settings-group-title">{t('settings.integrations.spotifyTitle')}</div>
            <div className="settings-row">
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
            <div className="settings-row">
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
              <input
                type="password"
                className="settings-input settings-input--wide"
                value={spotifyClientSecret}
                onChange={(event) => setSpotifyClientSecret(event.target.value)}
                placeholder={
                  integrationStatus?.spotifyClientSecretConfigured
                    ? t('settings.integrations.secretReplace')
                    : ''
                }
                autoComplete="new-password"
              />
            </div>
            {integrationStatus?.spotifyClientSecretConfigured && (
              <label className="settings-row-sublabel">
                <input
                  type="checkbox"
                  checked={clearSpotifyClientSecret}
                  onChange={(event) => setClearSpotifyClientSecret(event.target.checked)}
                />{' '}
                {t('settings.integrations.clearSecret')}
              </label>
            )}
            <div className="settings-row">
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
            <div className="settings-row">
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
                disabled={integrationBusy}
              >
                {integrationBusy
                  ? t('settings.integrations.saving')
                  : t('settings.integrations.save')}
              </button>
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-group-title">{t('settings.integrations.mealSourceTitle')}</div>
            <p className="settings-row-sublabel">
              {t('settings.integrations.mealSourceDescription')}
            </p>
            <div className="settings-row">
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
            <div className="settings-row">
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
              <input
                type="password"
                className="settings-input settings-input--wide"
                value={mealSourceToken}
                onChange={(event) => setMealSourceToken(event.target.value)}
                placeholder={
                  integrationStatus?.mealSourceTokenConfigured
                    ? t('settings.integrations.secretReplace')
                    : ''
                }
                autoComplete="new-password"
              />
            </div>
            {integrationStatus?.mealSourceTokenConfigured && (
              <label className="settings-row-sublabel">
                <input
                  type="checkbox"
                  checked={clearMealSourceToken}
                  onChange={(event) => setClearMealSourceToken(event.target.checked)}
                />{' '}
                {t('settings.integrations.clearSecret')}
              </label>
            )}
            <div className="settings-row-sublabel">
              {t('settings.integrations.mealSourceMappingHelp')}
            </div>
            {MEAL_MAPPING_FIELDS.map((field) => (
              <div className="settings-row" key={field.key}>
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
                disabled={integrationBusy}
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
          <p className="settings-row-sublabel">
            {t('settings.integrations.mealSourceBackendRequired')}
          </p>
        </div>
      )}

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.integrations.grocyTitle')}</div>
        <div className="settings-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className={`settings-status-dot ${settings.grocyEnabled ? 'settings-status-dot--connected' : 'settings-status-dot--disconnected'}`}
            />
            <div>
              <div className="settings-row-label">{t('settings.integrations.grocyLabel')}</div>
              <div className="settings-row-sublabel">
                {t('settings.integrations.grocySublabel')}
              </div>
            </div>
          </div>
          <Toggle
            checked={settings.grocyEnabled}
            onChange={(v) => onUpdateSettings({ grocyEnabled: v })}
          />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.integrations.anylistTitle')}</div>
        <div className="settings-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className={`settings-status-dot ${settings.anylistEnabled ? 'settings-status-dot--connected' : 'settings-status-dot--disconnected'}`}
            />
            <div>
              <div className="settings-row-label">{t('settings.integrations.anylistLabel')}</div>
              <div className="settings-row-sublabel">
                {t('settings.integrations.anylistSublabel')}
              </div>
            </div>
          </div>
          <Toggle
            checked={settings.anylistEnabled}
            onChange={(v) => onUpdateSettings({ anylistEnabled: v })}
          />
        </div>
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
        <div className="settings-row">
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
        <div className="settings-row">
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
        <div className="settings-row">
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
        <div className="settings-row">
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
        <div className="settings-row">
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
        <div className="settings-row">
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
    </>
  );
}
