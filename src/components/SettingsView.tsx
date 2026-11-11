import { useState, useCallback } from 'react';
import {
  Settings as SettingsIcon,
  Palette,
  Users,
  CalendarDays,
  Plug,
  Monitor,
  ListChecks,
  Info,
} from 'lucide-react';
import type { FamilyMember } from '../types/family';
import type { AbbaiSettings } from '../hooks/useSettings';
import { PageHeader } from './PageHeader';
import { GeneralSection } from './settings/sections/GeneralSection';
import { ChoresSection } from './settings/sections/ChoresSection';
import { AboutSection } from './settings/sections/AboutSection';
import { AppearanceSection } from './settings/sections/AppearanceSection';
import { FamilySection } from './settings/sections/FamilySection';
import { DisplaySection } from './settings/sections/DisplaySection';
import { CalendarSection } from './settings/sections/CalendarSection';
import { IntegrationsSection } from './settings/sections/IntegrationsSection';
import { useTranslation, type TranslationKey } from '../i18n';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SettingsSection =
  | 'general'
  | 'appearance'
  | 'family'
  | 'calendar'
  | 'integrations'
  | 'display'
  | 'chores'
  | 'about';

interface SettingsViewProps {
  settings: AbbaiSettings;
  onUpdateSettings: (patch: Partial<AbbaiSettings>) => void;
  onResetSettings: () => void;
  onExportSettings: () => string;
  onImportSettings: (json: string) => void;
  onClearLocalStorage: () => void;
  // Family
  members: FamilyMember[];
  onAddMember: (member: Omit<FamilyMember, 'id'>) => void;
  onUpdateMember: (id: string, data: Partial<Omit<FamilyMember, 'id'>>) => void;
  onRemoveMember: (id: string) => void;
  // HA connection
  connected: boolean;
  haUrl: string;
  // Calendars
  calendars: Array<{ id: string; name: string; color?: string }>;
  // Kid Display
  onEnterFocusMode: (memberId: string) => void;
}

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

const NAV_ITEMS: Array<{ id: SettingsSection; labelKey: TranslationKey; icon: React.ReactNode }> = [
  { id: 'general', labelKey: 'settings.nav.general', icon: <SettingsIcon size={18} /> },
  { id: 'appearance', labelKey: 'settings.nav.appearance', icon: <Palette size={18} /> },
  { id: 'family', labelKey: 'settings.nav.family', icon: <Users size={18} /> },
  { id: 'calendar', labelKey: 'settings.nav.calendar', icon: <CalendarDays size={18} /> },
  { id: 'integrations', labelKey: 'settings.nav.integrations', icon: <Plug size={18} /> },
  { id: 'display', labelKey: 'settings.nav.display', icon: <Monitor size={18} /> },
  { id: 'chores', labelKey: 'settings.nav.chores', icon: <ListChecks size={18} /> },
  { id: 'about', labelKey: 'settings.nav.about', icon: <Info size={18} /> },
];

// ---------------------------------------------------------------------------
// Reusable sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsView({
  settings,
  onUpdateSettings,
  onResetSettings,
  onExportSettings,
  onImportSettings,
  onClearLocalStorage,
  members,
  onAddMember,
  onUpdateMember,
  onRemoveMember,
  connected,
  haUrl,
  calendars,
  onEnterFocusMode,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');

  // ---- Export/Import ----
  const handleExport = useCallback(() => {
    const json = onExportSettings();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'beacon-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [onExportSettings]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onImportSettings(reader.result);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [onImportSettings]);

  // ---- Render sections ----
  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return renderGeneral();
      case 'appearance':
        return renderAppearance();
      case 'family':
        return renderFamily();
      case 'calendar':
        return renderCalendar();
      case 'integrations':
        return renderIntegrations();
      case 'display':
        return renderDisplay();
      case 'chores':
        return renderChores();
      case 'about':
        return renderAbout();
    }
  };

  // ==== GENERAL ====
  const renderGeneral = () => (
    <GeneralSection settings={settings} onUpdateSettings={onUpdateSettings} t={t} />
  );
  const renderAppearance = () => (
    <AppearanceSection settings={settings} onUpdateSettings={onUpdateSettings} t={t} />
  );
  // ==== FAMILY ====
  const renderFamily = () => (
    <FamilySection
      settings={settings}
      onUpdateSettings={onUpdateSettings}
      t={t}
      members={members}
      onAddMember={onAddMember}
      onUpdateMember={onUpdateMember}
      onRemoveMember={onRemoveMember}
      calendars={calendars}
    />
  );
  // ==== CALENDAR ====
  const renderCalendar = () => (
    <CalendarSection
      settings={settings}
      onUpdateSettings={onUpdateSettings}
      t={t}
      calendars={calendars}
      members={members}
    />
  );
  // ==== INTEGRATIONS ====
  const renderIntegrations = () => (
    <IntegrationsSection
      settings={settings}
      onUpdateSettings={onUpdateSettings}
      t={t}
      connected={connected}
      haUrl={haUrl}
    />
  );
  // ==== DISPLAY ====
  const renderDisplay = () => (
    <DisplaySection
      settings={settings}
      onUpdateSettings={onUpdateSettings}
      t={t}
      members={members}
      onEnterFocusMode={onEnterFocusMode}
    />
  );
  // ==== CHORES ====
  // Chore data lives in the ChoreOps integration: Abbai Flow has no local chore
  // store, so streaks, values and payouts are configured in Home Assistant.
  const renderChores = () => (
    <ChoresSection settings={settings} onUpdateSettings={onUpdateSettings} t={t} />
  );
  // ==== ABOUT ====
  const renderAbout = () => (
    <AboutSection
      settings={settings}
      onUpdateSettings={onUpdateSettings}
      t={t}
      connected={connected}
      haUrl={haUrl}
      onExport={handleExport}
      onImport={handleImport}
      onClearLocalStorage={onClearLocalStorage}
      onResetSettings={onResetSettings}
    />
  );
  return (
    <div className="view-page">
      <PageHeader title={t('settings.title')} />
      <div className="view-page-body">
        <div className="settings-view">
          <nav className="settings-nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-nav-item ${activeSection === item.id ? 'settings-nav-item--active' : ''}`}
                onClick={() => setActiveSection(item.id)}
              >
                {item.icon}
                {t(item.labelKey)}
              </button>
            ))}
          </nav>
          <div className="settings-content">{renderSection()}</div>
        </div>
      </div>
    </div>
  );
}
