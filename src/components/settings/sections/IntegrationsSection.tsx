/**
 * Integrations settings: Home Assistant connection status, Grocy, AnyList,
 * grocery lists, Music Assistant and the photo slideshow options.
 *
 * The todo-list lookup only feeds these controls, so the fetch lives here.
 */
import { useEffect, useState } from 'react';
import { AnyListClient } from '../../../api/anylist';
import type { GroceryList } from '../../../types/grocery';
import { Segment, Slider, Toggle } from '../controls';
import type { SettingsSectionContext } from './context';

export interface IntegrationsSectionProps extends SettingsSectionContext {
  connected: boolean;
  haUrl: string;
}

export function IntegrationsSection({
  settings,
  onUpdateSettings,
  t,
  connected,
  haUrl,
}: IntegrationsSectionProps) {
  const [todoLists, setTodoLists] = useState<GroceryList[]>([]);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className={`settings-status-dot ${connected ? 'settings-status-dot--connected' : 'settings-status-dot--disconnected'}`}
            />
            <div>
              <div className="settings-row-label">
                {t('settings.integrations.connectionStatusLabel')}
              </div>
              <div className="settings-row-sublabel">
                {connected
                  ? t('settings.integrations.connected')
                  : t('settings.integrations.disconnected')}{' '}
                &middot; {haUrl}
              </div>
            </div>
          </div>
        </div>
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
