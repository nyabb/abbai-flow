import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { startOfWeek, addDays, format } from 'date-fns';
import { useMergedCalendars } from './hooks/useMergedCalendars';
import { useFamily } from './hooks/useFamily';
import { useChoresMan } from './hooks/useChoresMan';
import { resolveMemberForUser } from './api/chore-model';
import { CHORESMAN_CALENDAR_PREFIX } from './api/choresman-calendar';
import { choreIconForDisplay } from './api/chore-planner-view';
import { WeekCalendar } from './components/WeekCalendar';
import { PortraitAgenda } from './components/PortraitAgenda';
import { EventModal, EventFormData } from './components/EventModal';
import { FamilyFilter } from './components/FamilyFilter';
import { SettingsView } from './components/SettingsView';
import { useSettings } from './hooks/useSettings';
import { ChorePlanner } from './components/ChorePlanner';
import { LoadingPlaceholder } from './components/LoadingPlaceholder';
import { TimerAlarm } from './components/TimerAlarm';
import { TimerDock } from './components/TimerDock';
import { DebugConsole } from './components/DebugConsole';
import { Sidebar, SidebarView } from './components/Sidebar';
import { MusicView } from './components/MusicView';
import { MealsView } from './components/MealsView';
import { useNotifications } from './hooks/useNotifications';
import { ScreenSaver } from './components/ScreenSaver';
import { GroceryView } from './components/GroceryView';
import { OmniAdd } from './components/OmniAdd';
import { CalendarSidebar } from './components/CalendarSidebar';
import { Timer } from './components/Timer';
import { useConnectionStatus } from './hooks/useConnectionStatus';
import { useScreenWakeLock } from './hooks/useScreenWakeLock';
import { WeatherView } from './components/WeatherView';
import { PageHeader } from './components/PageHeader';
import { useTheme } from './hooks/useTheme';
import { useTouchPageSwipe } from './hooks/useTouchPageSwipe';
import { isStringArray, usePersistentState } from './hooks/usePersistentState';
import { TOUCH_NAV_ORDER } from './utils/touch-navigation';
import { useTaskLists } from './hooks/useTaskLists';
import { FocusView } from './components/focus/FocusView';
import { getFocusMemberId, clearFocusMode, setDeviceFocusMember } from './focus';
import { CalendarEvent } from './types';
import type { ChoresManChore } from './types/choresman';
import { useMediaQuery } from './hooks/useMediaQuery';
import { I18nContext, createI18n } from './i18n';
import { useSpotifyPlaylists } from './hooks/useSpotifyPlaylists';
import { useSpotifyBrowserPlayer } from './hooks/useSpotifyBrowserPlayer';
import { useSpotifyCatalog } from './hooks/useSpotifyCatalog';
import { useIntegrationHealth } from './hooks/useIntegrationHealth';
import { MusicDock } from './components/MusicDock';
import { MusicDockContext } from './components/MusicDockContext';
const EMPTY_CHORESMAN_CHORES: ChoresManChore[] = [];

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

const supportsNativeViewTransitions =
  typeof document !== 'undefined' &&
  typeof (document as ViewTransitionDocument).startViewTransition === 'function';

type EventDialogState =
  | { type: 'closed' }
  | { type: 'create'; prefillDate: string | null; prefillTime: string | null }
  | { type: 'edit'; event: CalendarEvent };

export function App() {
  const compact = useMediaQuery('(max-width: 600px)');
  const [integrationSettingsRevision, setIntegrationSettingsRevision] = useState(0);
  const [hasTransientSettingsError, setHasTransientSettingsError] = useState(false);
  const spotifyPlaylists = useSpotifyPlaylists();
  const refreshSpotifyPlaylists = spotifyPlaylists.refresh;
  const spotifyCatalog = useSpotifyCatalog();
  const spotifyBrowser = useSpotifyBrowserPlayer(
    spotifyPlaylists.status.authorized,
    spotifyPlaylists.status.playbackAuthorized === true,
  );
  const [musicDockOpen, setMusicDockOpen] = useState(false);
  const musicDockContext = useMemo(
    () => ({
      open: musicDockOpen,
      playing: spotifyBrowser.snapshot.playback.status === 'playing',
      toggle: () => setMusicDockOpen((current) => !current),
    }),
    [musicDockOpen, spotifyBrowser.snapshot.playback.status],
  );
  const integrationAttention = useIntegrationHealth(
    integrationSettingsRevision,
    spotifyPlaylists.status,
  );
  const settingsAttention = useMemo(
    () => {
      const next = [...integrationAttention];
      if (
        spotifyPlaylists.error &&
        !next.some((attention) => attention.field === 'spotifyAccount')
      ) {
        next.push({ id: 'spotify:spotifyAccountError', group: 'spotify', field: 'spotifyAccount' });
      }
      if (/reconnect spotify|premium is required/i.test(spotifyBrowser.snapshot.error || '')) {
        const field = /premium is required/i.test(spotifyBrowser.snapshot.error || '')
          ? 'spotifyPlayback'
          : 'spotifyAccount';
        if (!next.some((attention) => attention.field === field)) {
          next.push({ id: `spotify:${field}Error`, group: 'spotify', field });
        }
      }
      if (hasTransientSettingsError) {
        next.push({ id: 'transient:settings', group: 'transient', field: 'transientError' });
      }
      return next;
    },
    [
      hasTransientSettingsError,
      integrationAttention,
      spotifyBrowser.snapshot.error,
      spotifyPlaylists.error,
    ],
  );
  const hasSettingsAttention = settingsAttention.length > 0;
  const {
    settings,
    updateSettings,
    resetSettings,
    exportSettings,
    importSettings,
    clearLocalStorage,
  } = useSettings();

  const changeLocale = useCallback(
    (locale: string) => updateSettings({ locale }),
    [updateSettings],
  );
  const i18n = useMemo(
    () => createI18n(settings.locale, changeLocale),
    [settings.locale, changeLocale],
  );
  const { t } = i18n;

  const { members, addMember, updateMember, removeMember } = useFamily();
  const { data: choresManData, runActionId: runChoresManAction } = useChoresMan(members);

  const mergedCalendars = useMergedCalendars({
    calendarColors: settings.calendarColors,
    members,
    chores: choresManData?.chores ?? EMPTY_CHORESMAN_CHORES,
  });
  const {
    calendars,
    events,
    loading: calendarEventsLoading,
    fetchCalendars,
    fetchEvents,
    createEvent,
    updateEvent,
    deleteEvent,
  } = mergedCalendars;

  const taskLists = useTaskLists(
    settings.groceryListIds,
    settings.taskListIds ?? [],
    integrationSettingsRevision,
  );

  const handleIntegrationSettingsSaved = useCallback(() => {
    setIntegrationSettingsRevision((current) => current + 1);
    void refreshSpotifyPlaylists();
  }, [refreshSpotifyPlaylists]);

  // Apply theme at App level so it stays active regardless of which view is shown
  const { setTheme } = useTheme(settings);
  useEffect(() => {
    setTheme(settings.themeId);
  }, [settings.themeId, setTheme]);

  // Calendar pills are a view filter; settings visibility remains the separate
  // way to remove a calendar from the view entirely.
  const [temporarilyHiddenCalendarIds, setTemporarilyHiddenCalendarIds] = usePersistentState(
    'abbai-flow-filter-calendar-hidden',
    [],
    isStringArray,
  );
  const temporarilyHiddenCalendars = useMemo(
    () => new Set(temporarilyHiddenCalendarIds),
    [temporarilyHiddenCalendarIds],
  );
  const permanentlyHiddenCalendars = useMemo(
    () => new Set(settings.permanentlyHiddenCalendars),
    [settings.permanentlyHiddenCalendars],
  );
  const writableEnabledCalendars = useMemo(
    () =>
      calendars.filter(
        (calendar) =>
          !calendar.readOnly && !permanentlyHiddenCalendars.has(calendar.id),
      ),
    [calendars, permanentlyHiddenCalendars],
  );
  const hiddenCalendars = useMemo(
    () => new Set([...permanentlyHiddenCalendars, ...temporarilyHiddenCalendars]),
    [permanentlyHiddenCalendars, temporarilyHiddenCalendars],
  );
  const filterableCalendars = useMemo(
    () => calendars.filter((calendar) => !permanentlyHiddenCalendars.has(calendar.id)),
    [calendars, permanentlyHiddenCalendars],
  );

  useEffect(() => {
    setTemporarilyHiddenCalendarIds((previous) => {
      const next = previous.filter((id) => !permanentlyHiddenCalendars.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [permanentlyHiddenCalendars, setTemporarilyHiddenCalendarIds]);

  const visibleEvents = useMemo(
    () => events.filter((event) => !hiddenCalendars.has(event.calendarId)),
    [events, hiddenCalendars],
  );
  const [eventDialog, setEventDialog] = useState<EventDialogState>({ type: 'closed' });
  const selectedEvent = eventDialog.type === 'edit' ? eventDialog.event : null;
  const eventModalCalendars = useMemo(() => {
    if (
      !selectedEvent ||
      writableEnabledCalendars.some((calendar) => calendar.id === selectedEvent.calendarId)
    ) {
      return writableEnabledCalendars;
    }
    const currentCalendar = calendars.find((calendar) => calendar.id === selectedEvent.calendarId);
    return currentCalendar ? [currentCalendar, ...writableEnabledCalendars] : writableEnabledCalendars;
  }, [calendars, selectedEvent, writableEnabledCalendars]);
  const showModal = eventDialog.type !== 'closed';
  const prefillDate = eventDialog.type === 'create' ? eventDialog.prefillDate : null;
  const prefillTime = eventDialog.type === 'create' ? eventDialog.prefillTime : null;
  const [choreCreate, setChoreCreate] = useState<{ kind: 'chore' | 'routine'; token: number }>({
    kind: 'chore',
    token: 0,
  });
  const [activeView, setActiveView] = useState<SidebarView>(() => {
    const requestedView = new URLSearchParams(window.location.search).get('view');
    if (requestedView === 'music' || requestedView === 'meals') return requestedView;
    const stored = settings.defaultView as string;
    // "Tasks" merged into the single lists page; keep older installs working.
    if (stored === 'tasks') return 'grocery';
    if (stored === 'dashboard') return 'calendar';
    return (stored as SidebarView) || 'calendar';
  });

  // Kid Display (focus) mode — URL param wins, then device-local storage
  const [focusMemberId, setFocusMemberId] = useState<string | null>(() => getFocusMemberId());
  const focusMember = focusMemberId ? members.find((m) => m.id === focusMemberId) : undefined;

  // Escape hatch: if a display is assigned to a member but the family list
  // stays empty (fresh device, stale assignment), stop waiting after 10s and
  // fall through to the invalid-member banner instead of loading forever.
  const [focusLoadTimedOut, setFocusLoadTimedOut] = useState(false);
  useEffect(() => {
    if (!focusMemberId || members.length > 0) {
      setFocusLoadTimedOut(false);
      return;
    }
    const t = setTimeout(() => setFocusLoadTimedOut(true), 10_000);
    return () => clearTimeout(t);
  }, [focusMemberId, members.length]);

  const focusInvalid = !!focusMemberId && !focusMember && (members.length > 0 || focusLoadTimedOut);

  const handleExitFocus = useCallback(() => {
    clearFocusMode();
    setFocusMemberId(null);
  }, []);

  const handleEnterFocusMode = useCallback((memberId: string) => {
    setDeviceFocusMember(memberId);
    setFocusMemberId(memberId);
  }, []);

  // Visible week shown by the calendar (drives event fetch window)
  const [visibleWeekStart, setVisibleWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: settings.weekStartsOn }),
  );

  // Helper: refetch events for a given week, with one extra day on either side
  // so multi-day events that bleed in/out of the visible week still render.
  const refetchEventsForWeek = useCallback(
    async (weekStart: Date) => {
      const rangeStart = addDays(weekStart, -1);
      const rangeEnd = addDays(weekStart, 8);
      await fetchEvents(rangeStart.toISOString(), rangeEnd.toISOString());
    },
    [fetchEvents],
  );

  // Event notifications use the browser's notification API.
  useNotifications(events, !focusMemberId, settings.notificationMinutes);

  // Fetch CalDAV calendar data when the app starts, or when the user navigates
  // to a different week or changes integration settings.
  useEffect(() => {
    const loadData = async () => {
      await fetchCalendars();
      await refetchEventsForWeek(visibleWeekStart);
    };

    loadData();

    // Refresh every 5 minutes for the currently-visible week
    const interval = setInterval(
      () => {
        refetchEventsForWeek(visibleWeekStart);
      },
      5 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, [fetchCalendars, integrationSettingsRevision, refetchEventsForWeek, visibleWeekStart]);

  // Re-fetch when calendar colors or family members change so colors update
  // immediately, without recreating the 5-minute polling interval above.
  const colorRefreshRef = useRef({
    fetchCalendars,
    refetchEventsForWeek,
    visibleWeekStart,
  });
  colorRefreshRef.current = { fetchCalendars, refetchEventsForWeek, visibleWeekStart };
  const didColorRefreshMount = useRef(false);
  useEffect(() => {
    if (!didColorRefreshMount.current) {
      didColorRefreshMount.current = true;
      return;
    }
    colorRefreshRef.current.fetchCalendars();
    colorRefreshRef.current.refetchEventsForWeek(colorRefreshRef.current.visibleWeekStart);
  }, [settings.calendarColors, members]);

  const handleToggleCalendar = useCallback(
    (calendarId: string) => {
      setTemporarilyHiddenCalendarIds((prev) => {
        return prev.includes(calendarId)
          ? prev.filter((id) => id !== calendarId)
          : [...prev, calendarId];
      });
    },
    [setTemporarilyHiddenCalendarIds],
  );

  const handleEventClick = useCallback((event: CalendarEvent) => {
    if (event.readOnly) {
      if (event.calendarId.startsWith(CHORESMAN_CALENDAR_PREFIX)) {
        setActiveView('chores');
      }
      return;
    }
    setEventDialog({ type: 'edit', event });
  }, []);

  const handleSlotClick = useCallback((date: string, hour: number) => {
    setEventDialog({
      type: 'create',
      prefillDate: date,
      prefillTime: `${String(hour).padStart(2, '0')}:00`,
    });
  }, []);

  const handleCloseModal = useCallback(() => {
    setEventDialog({ type: 'closed' });
  }, []);

  const handleSaveEvent = useCallback(
    async (calendarId: string, data: EventFormData) => {
      const isCreatingOrMoving = !selectedEvent || calendarId !== selectedEvent.calendarId;
      if (
        isCreatingOrMoving &&
        !writableEnabledCalendars.some((calendar) => calendar.id === calendarId)
      ) {
        throw new Error(t('eventModal.errorNoWritableCalendars'));
      }
      const eventData = data.allDay
        ? {
            summary: data.summary,
            start_date: data.startDate,
            // CalDAV uses an exclusive end date for all-day events. When the
            // user picks the same start/end date, bump it by one day.
            end_date:
              data.endDate <= data.startDate
                ? format(addDays(new Date(`${data.startDate}T00:00:00`), 1), 'yyyy-MM-dd')
                : data.endDate,
            description: data.description || undefined,
          }
        : {
            summary: data.summary,
            start_date_time: `${data.startDate}T${data.startTime}:00`,
            end_date_time: `${data.endDate}T${data.endTime}:00`,
            description: data.description || undefined,
          };

      // Build rrule if recurrence is set
      if (data.recurrence && data.recurrence !== 'none') {
        const freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' } as const;
        const freq = freqMap[data.recurrence];
        const until = data.recurrenceEnd.replace(/-/g, '') + 'T235959Z';
        (eventData as Record<string, unknown>).rrule = `FREQ=${freq};UNTIL=${until}`;
      }

      try {
        if (selectedEvent) {
          // Editing an existing event — update in place rather than creating
          // a duplicate. `selectedEvent.calendarId` is the event's original
          // calendar; if the user changed the calendar in the form, move it
          // by deleting from the old calendar and creating on the new one.
          if (selectedEvent.hasStableId === false) {
            throw new Error(
              "This event can't be edited — it has no stable ID from its calendar provider.",
            );
          }
          if (calendarId !== selectedEvent.calendarId) {
            await deleteEvent(selectedEvent.calendarId, selectedEvent.id);
            await createEvent(calendarId, eventData);
          } else {
            await updateEvent(calendarId, selectedEvent.id, eventData);
          }
        } else {
          await createEvent(calendarId, eventData);
        }

        await refetchEventsForWeek(visibleWeekStart);

        handleCloseModal();
      } catch (err) {
        console.error('Failed to save event:', err);
        // Re-throw so EventModal can surface an inline error to the user
        // instead of the save silently appearing to do nothing.
        throw err;
      }
    },
    [
      selectedEvent,
      createEvent,
      updateEvent,
      deleteEvent,
      refetchEventsForWeek,
      visibleWeekStart,
      handleCloseModal,
      writableEnabledCalendars,
      t,
    ],
  );

  const handleDeleteEvent = useCallback(
    async (calendarId: string, eventId: string) => {
      try {
        if (selectedEvent && selectedEvent.id === eventId && selectedEvent.hasStableId === false) {
          throw new Error(
            "This event can't be deleted — it has no stable ID from its calendar provider.",
          );
        }
        await deleteEvent(calendarId, eventId);

        await refetchEventsForWeek(visibleWeekStart);

        handleCloseModal();
      } catch (err) {
        console.error('Failed to delete event:', err);
        throw err;
      }
    },
    [selectedEvent, deleteEvent, refetchEventsForWeek, visibleWeekStart, handleCloseModal],
  );

  const handleEventReschedule = useCallback(
    async (event: CalendarEvent, newDate: string, newHour: number) => {
      if (event.readOnly) return;
      try {
        const oldStart = new Date(event.start);
        const oldEnd = new Date(event.end);
        const durationMs = oldEnd.getTime() - oldStart.getTime();

        const patch = event.allDay
          ? {
              start_date: newDate,
              end_date: format(new Date(new Date(newDate).getTime() + durationMs), 'yyyy-MM-dd'),
            }
          : (() => {
              const pad = (n: number) => String(n).padStart(2, '0');
              const newStartDt = `${newDate}T${pad(newHour)}:00:00`;
              const newEndTime = new Date(new Date(newStartDt).getTime() + durationMs);
              const newEndDt = `${format(newEndTime, 'yyyy-MM-dd')}T${pad(newEndTime.getHours())}:${pad(newEndTime.getMinutes())}:00`;
              return { start_date_time: newStartDt, end_date_time: newEndDt };
            })();

        await updateEvent(event.calendarId, event.id, patch);

        await refetchEventsForWeek(visibleWeekStart);
      } catch (err) {
        console.error('Failed to reschedule event:', err);
      }
    },
    [updateEvent, refetchEventsForWeek, visibleWeekStart],
  );

  const handleAddEvent = useCallback(() => {
    setEventDialog({
      type: 'create',
      prefillDate: null,
      prefillTime: null,
    });
  }, []);

  const handleChangeView = useCallback(
    (view: SidebarView, afterNavigate?: () => void) => {
      const updateView = () =>
        flushSync(() => {
          // Quick-add requests are one-shot; clear one before leaving so remounting
          // the planner does not replay an already handled routine/chore request.
          if (view !== 'chores') setChoreCreate({ kind: 'chore', token: 0 });
          if (view !== activeView) setActiveView(view);
          afterNavigate?.();
        });

      if (view === activeView || settings.reducedMotion || !supportsNativeViewTransitions) {
        updateView();
        return;
      }

      const fromIndex = TOUCH_NAV_ORDER.indexOf(activeView);
      const toIndex = TOUCH_NAV_ORDER.indexOf(view);
      document.documentElement.dataset.pageTransitionDirection =
        toIndex >= fromIndex ? 'forward' : 'backward';

      try {
        const startViewTransition = (document as ViewTransitionDocument).startViewTransition;
        if (startViewTransition) startViewTransition.call(document, updateView);
        else updateView();
      } catch {
        // Keep navigation working if a browser cancels or rejects a transition.
        updateView();
      }
    },
    [activeView, settings.reducedMotion],
  );

  const pageSwipeHandlers = useTouchPageSwipe({
    activeView,
    navigationOrder: TOUCH_NAV_ORDER,
    onNavigate: handleChangeView,
  });

  /* Quick add lives at the lower right on mobile. Routines use the same
     Abbai Flow editor from whichever view opens them. */
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const requestChoreCreate = useCallback(
    (kind: 'chore' | 'routine') => {
      handleChangeView('chores', () =>
        setChoreCreate((previous) => ({ kind, token: previous.token + 1 })),
      );
    },
    [handleChangeView],
  );

  // ---- Chore data ----
  // ChoresMan owns chores, points and rewards; family profiles stay in sync
  // with its local member records through the shared hook.
  const { reconnected, state: connectionState } = useConnectionStatus();
  useScreenWakeLock(settings.alwaysOnDisplay);

  // One refresh per recovery. Calendars and events are not polled, so nothing
  // else would notice that the server came back.
  useEffect(() => {
    if (!reconnected) return;
    void fetchCalendars();
  }, [reconnected, fetchCalendars]);

  const calendarChores = useMemo(
    () =>
      (choresManData?.chores ?? [])
        .filter((chore) => {
          if (chore.status === 'completed_by_other') return false;
          if (chore.showOnCalendar === false) return false;
          if (!chore.dueDate) {
            return chore.frequency === 'none' || /^daily/.test(chore.frequency ?? '');
          }
          return new Date(chore.dueDate).toDateString() === new Date().toDateString();
        })
        .map((chore) => {
          /* ChoresMan publishes a row per assignee, so the calendar can show
           * each child's work under their own name and complete it independently. */
          const member = chore.assignee ? resolveMemberForUser(chore.assignee, members) : null;

          return {
            id: chore.id,
            name: chore.name,
            assigned_to: member ? [member.id] : [],
            frequency: /^daily/.test(chore.frequency ?? '')
              ? ('daily' as const)
              : ('once' as const),
            value_cents: 0,
            icon: choreIconForDisplay(chore.icon),
          };
        }),
    [choresManData, members],
  );

  const calendarCompletedChoreIds = useMemo(() => {
    const ids = new Set<string>();
    for (const chore of choresManData?.chores ?? []) {
      if (/^(approved|completed|done)$/i.test(chore.status)) {
        ids.add(chore.id);
      }
    }
    return ids;
  }, [choresManData]);

  const calendarWaitingChoreIds = useMemo(
    () =>
      new Set(
        (choresManData?.chores ?? [])
          .filter((chore) => ['in_progress', 'claimed'].includes(chore.status))
          .map((chore) => chore.id),
      ),
    [choresManData],
  );

  const handleCalendarToggleChore = useCallback(
    (choreId: string) => {
      // Taking a shared chore assigns it; ticking an assigned chore submits it
      // for review. Parent approval stays in the PIN-gated planner flow.
      const chore = choresManData?.chores.find((item) => item.id === choreId);
      const actionId = chore?.actions.take ?? chore?.actions.claim;
      if (actionId) void runChoresManAction(actionId);
    },
    [choresManData, runChoresManAction],
  );

  // Keyboard shortcuts for quick view switching
  useEffect(() => {
    const viewMap: Record<string, SidebarView> = {
      '1': 'calendar',
      '2': 'chores',
      '3': 'grocery',
      '4': 'music',
      '9': 'timer',
      '0': 'settings',
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const view = viewMap[e.key];
      if (view) {
        e.preventDefault();
        handleChangeView(view);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleChangeView]);

  const withDebugConsole = (content: ReactNode) => (
    <I18nContext.Provider value={i18n}>
      <MusicDockContext.Provider value={musicDockContext}>
        {content}
        <MusicDock
          open={musicDockOpen}
          onClose={() => setMusicDockOpen(false)}
          snapshot={spotifyBrowser.snapshot}
          onControl={spotifyBrowser.control}
          onOpen={() => handleChangeView('music')}
        />
      </MusicDockContext.Provider>
      <DebugConsole enabled={settings.debugMode} />
    </I18nContext.Provider>
  );

  // Kid Display mode: replace the entire shell (same pattern as onboarding)
  if (focusMember) {
    return withDebugConsole(
      <FocusView memberId={focusMember.id} settings={settings} onExit={handleExitFocus} />,
    );
  }

  // Focus member requested but members not loaded yet (fresh device cache):
  // hold on a lightweight loading screen instead of flashing the full app.
  if (focusMemberId && members.length === 0 && !focusLoadTimedOut) {
    return withDebugConsole(
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg-primary)',
        }}
      >
        <LoadingPlaceholder
          label={t('app.connecting')}
          lines={3}
          className="loading-placeholder--screen"
        />
      </div>,
    );
  }

  return (
    <I18nContext.Provider value={i18n}>
      <MusicDockContext.Provider value={musicDockContext}>
      <div
        className={`abbai-flow abbai-flow--bottom-nav ${compact ? 'abbai-flow--compact' : ''} ${activeView === 'chores' ? 'abbai-flow--chores' : ''} ${settings.reducedMotion ? ' abbai-flow--reduce-motion' : ''} ${supportsNativeViewTransitions ? ' abbai-flow--view-transition-supported' : ''}`}
      >
        {focusInvalid && (
          <div className="focus-invalid-banner">
            {t('app.kidDisplayNotFound')}
            <button type="button" className="settings-btn" onClick={handleExitFocus}>
              {t('app.dismiss')}
            </button>
          </div>
        )}
        <Sidebar activeView={activeView} onChangeView={handleChangeView} />

        {/* A countdown belongs to the household, not to the timer page: the
            alarm rings and the dock shows what is left on every view, with
            pause/delete right there so the timer page is optional. */}
        <TimerAlarm />
        {activeView !== 'timer' && <TimerDock onOpen={() => handleChangeView('timer')} />}
        <DebugConsole enabled={settings.debugMode} />

        {/* Main content area */}
        <div
          className="abbai-flow-main"
          onTouchStart={pageSwipeHandlers.onTouchStart}
          onTouchEnd={pageSwipeHandlers.onTouchEnd}
          onTouchCancel={pageSwipeHandlers.onTouchCancel}
        >
          {activeView === 'chores' ? (
            <ChorePlanner
              members={members}
              locale={settings.locale}
              weekStartsOn={settings.weekStartsOn}
              createRequest={choreCreate}
            />
          ) : activeView === 'music' ? (
            <div className="view-page">
              <PageHeader title={t('nav.music')} />
              <div className="view-page-body">
                <MusicView
                  playlists={spotifyPlaylists}
                  snapshot={spotifyBrowser.snapshot}
                  loading={spotifyBrowser.loading}
                  onControl={spotifyBrowser.control}
                  onSearch={spotifyCatalog.search}
                  onConnectPlayback={spotifyPlaylists.connect}
                />
              </div>
            </div>
          ) : activeView === 'meals' ? (
            <div className="view-page">
              <PageHeader title={t('nav.meals')} />
              <div className="view-page-body meals-page-body">
                <MealsView
                  weekStartsOn={settings.weekStartsOn}
                  onOpenSettings={() => handleChangeView('settings')}
                />
              </div>
            </div>
          ) : activeView === 'settings' ? (
            <SettingsView
              settings={settings}
              onUpdateSettings={updateSettings}
              onResetSettings={resetSettings}
              onExportSettings={exportSettings}
              onImportSettings={importSettings}
              onClearLocalStorage={clearLocalStorage}
              members={members}
              onAddMember={addMember}
              onUpdateMember={updateMember}
              onRemoveMember={removeMember}
              onIntegrationSettingsSaved={handleIntegrationSettingsSaved}
              settingsAttention={settingsAttention}
              onConnectSpotify={spotifyPlaylists.connect}
              onSettingsErrorChange={setHasTransientSettingsError}
              calendars={calendars}
              onEnterFocusMode={handleEnterFocusMode}
            />
          ) : activeView === 'grocery' ? (
            <GroceryView
              defaultListId={settings.defaultGroceryList || undefined}
              groceryListIds={settings.groceryListIds}
              taskListIds={settings.taskListIds ?? []}
            />
          ) : activeView === 'timer' ? (
            <div className="view-page">
              <PageHeader title={t('nav.timer')} />
              <div className="view-page-body">
                <Timer />
              </div>
            </div>
          ) : activeView === 'weather' ? (
            <div className="view-page">
              <PageHeader title={t('nav.weather')} />
              <div className="view-page-body">
                <WeatherView />
              </div>
            </div>
          ) : (
            <>
              {/* Header — the shared hero band: big date, page title, live clock. */}
              <PageHeader
                title={settings.familyName}
                actions={
                  connectionState !== 'online' ? (
                    <div className="connection-status">
                      <span className="connection-dot" />
                      {t('app.connecting')}
                    </div>
                  ) : undefined
                }
              />

              {/* Family filter pills — above the calendar */}
              <div className="filter-bar">
                <FamilyFilter
                  calendars={filterableCalendars}
                  hiddenCalendars={temporarilyHiddenCalendars}
                  onToggle={handleToggleCalendar}
                />
              </div>

              {/* Calendar Body — two-column on desktop */}
              <div className="abbai-flow-body abbai-flow-body--two-col">
                <div className="abbai-flow-body-calendar">
                  <WeekCalendar
                    events={events}
                    eventsLoading={calendarEventsLoading}
                    hiddenCalendars={hiddenCalendars}
                    onEventClick={handleEventClick}
                    onSlotClick={handleSlotClick}
                    onEventReschedule={handleEventReschedule}
                    onVisibleWeekChange={setVisibleWeekStart}
                    weekStartsOn={settings.weekStartsOn}
                  />
                  <PortraitAgenda
                    events={events}
                    eventsLoading={calendarEventsLoading}
                    hiddenCalendars={hiddenCalendars}
                    onEventClick={handleEventClick}
                    onSlotClick={handleSlotClick}
                    onVisibleWeekChange={setVisibleWeekStart}
                    weekStartsOn={settings.weekStartsOn}
                  />
                </div>
                <CalendarSidebar
                  events={visibleEvents}
                  chores={calendarChores}
                  completedChoreIds={calendarCompletedChoreIds}
                  waitingChoreIds={calendarWaitingChoreIds}
                  onToggleChore={handleCalendarToggleChore}
                  todoItems={taskLists.items}
                  eventsLoading={calendarEventsLoading}
                  tasksLoading={taskLists.loading}
                  onToggleTodo={taskLists.toggleItem}
                  members={members}
                />
              </div>
            </>
          )}
        </div>

        {/* Omni Add is anchored at the lower right on mobile. */}
        <OmniAdd
          open={quickAddOpen}
          onOpenChange={setQuickAddOpen}
          showTrigger
          onAddEvent={handleAddEvent}
          onAddGroceryItem={() => handleChangeView('grocery')}
          onAddChore={() => requestChoreCreate('chore')}
          onAddRoutine={() => requestChoreCreate('routine')}
          onNavigateTimer={() => handleChangeView('timer')}
          onNavigateSettings={() => handleChangeView('settings')}
          hasSettingsAttention={hasSettingsAttention}
          settingsActive={activeView === 'settings'}
        />

        {/* Event Modal */}
        {showModal && (
          <EventModal
            event={selectedEvent}
            calendars={eventModalCalendars}
            defaultCalendarId={settings.defaultCalendar}
            onSave={handleSaveEvent}
            onDelete={handleDeleteEvent}
            onClose={handleCloseModal}
            prefillDate={prefillDate}
            prefillTime={prefillTime}
          />
        )}

        {/* GroceryView is now rendered as a full view above */}

        {/* Screen saver / dim mode */}
        <ScreenSaver
          enabled={settings.screenSaverEnabled}
          dimTimeoutMin={settings.dimTimeout}
          screenSaverTimeoutMin={settings.screenSaverTimeout}
          mode={settings.screenSaverMode}
          timeFormat={settings.timeFormat}
          showSeconds={settings.showSeconds}
          photoIntervalSeconds={settings.photoInterval}
          photoTransition={settings.photoTransition}
        />

        <MusicDock
          open={musicDockOpen}
          onClose={() => setMusicDockOpen(false)}
          snapshot={spotifyBrowser.snapshot}
          onControl={spotifyBrowser.control}
          onOpen={() => handleChangeView('music')}
        />

      </div>
      </MusicDockContext.Provider>
    </I18nContext.Provider>
  );
}
