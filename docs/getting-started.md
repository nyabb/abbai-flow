# Getting Started with Abbai Flow

A visual walkthrough of Abbai Flow — your family's daily signal. This guide shows you what to expect after installation, with annotated screenshots of every major view at both desktop and mobile sizes.

> **Looking for installation instructions?** See the [README](../README.md) for quick-start steps, or the [full Getting Started guide](./README.md) on the docs site for detailed setup (Google Calendar, Docker, development, tablet mounting, and more).

---

## Table of Contents

- [Dashboard](#dashboard)
- [Calendar](#calendar)
- [Chores](#chores)
- [Lists (Grocery / Shopping)](#lists-grocery--shopping)
- [Meal Plan](#meal-plan)
- [Tasks](#tasks)
- [Music Controls](#music-controls)
- [Weather](#weather)
- [Settings](#settings)
- [Navigation: Desktop vs. Mobile](#navigation-desktop-vs-mobile)
- [Family Member Setup](#family-member-setup)
- [Theme Selection](#theme-selection)

---

## Dashboard

The dashboard is your family's home screen. At a glance you see:

- **Large clock and date** -- always visible, great for wall-mounted displays
- **Personalized greeting** -- "Good morning/afternoon/evening, {Family Name}"
- **Today's events** -- pulled from all connected Home Assistant calendar entities
- **Meal plan bar** -- today's dinner from AnyList or a local meal plan calendar
- **Weather chip** -- current temperature and conditions (tap to open the full weather view)
- **Task summary** -- outstanding tasks from your HA todo lists
- **Chores panel** -- each family member's assigned chores for the day
- **Chore planner** -- full-screen chores, routines and points view per child

### Desktop (1280 x 800)

![Dashboard — desktop](images/dashboard-desktop.png)

The sidebar on the left is the standard Home Assistant navigation. Abbai Flow's own sidebar runs vertically inside the add-on panel with icons for every view: Dashboard, Calendar, Chores, Lists, Tasks, Music, Photos, Timer, Weather, and Settings.

### Mobile (390 x 844)

![Dashboard — mobile](images/dashboard-mobile.png)

On mobile, Abbai Flow's navigation moves to a bottom tab bar with the most-used views (Dashboard, Calendar, Chores, Music) and a **More** menu for the rest.

---

## Calendar

The calendar shows a full week view with color-coded events from every connected calendar entity in Home Assistant.

**Key features:**

- **Calendar filter pills** -- toggle individual calendars on/off. Each pill shows the calendar name and its color.
- **Inline weather** -- high/low temperatures and condition icons appear in each day's header.
- **All-day events** -- displayed in a banner row at the top of each day.
- **Timed events** -- positioned on a time grid (7 AM -- 8 PM visible by default).
- **Quick add** -- tap any empty time slot to create a new event on that calendar.

### Desktop

![Calendar — desktop](images/calendar-desktop.png)

All seven days of the week are visible simultaneously with timed events placed on the grid.

### Mobile

![Calendar — mobile](images/calendar-mobile.png)

On mobile, the calendar shows a scrollable 3-day view with page navigation dots. Swipe or tap the arrow buttons to move between day groups. Calendar filter pills scroll horizontally.

---

## Chores

The chores view lets you assign recurring or one-off tasks to family members and track completion.

**Key features:**

- **Per-member cards** -- each family member shows their avatar, name, and assigned chores.
- **Add Chore button** -- create new chores with assignee, frequency, and optional allowance value.
- **Completion tracking** -- tap a chore to mark it done; completed chores add their points to that child's pot.

### Desktop

![Chores — desktop](images/chores-desktop.png)

On desktop the chores planner takes over the full content column, with the app sidebar still visible next to it.

---

## Lists (Grocery / Shopping)

The lists view manages shopping and inventory lists from multiple providers.

**Key features:**

- **List selector dropdown** -- switch between lists: local Shopping List, Home Assistant shopping lists, store-specific lists (Costco, Walmart, Target), and inventory lists (Pantry, Freezer, Fridge).
- **Quick add** -- type an item name and tap Add to append it to the active list.
- **Check off items** -- tap items to mark them as purchased/completed.
- **Multiple providers** -- supports AnyList, HA Shopping List, and built-in local lists.

### Desktop

![Lists — desktop](images/lists-desktop.png)

### Mobile

![Lists — mobile](images/lists-mobile.png)

On mobile the list selector is a full-width dropdown at the top, with the add-item input directly below it.

---

## Meal Plan

Today's meals are shown by the **Menu** card on the Dashboard: in the sidebar for the Family layout, in the right-hand column for the Classic layout. The card is hidden while nothing is planned for today, so an empty household never gets a blank block.

Each row is one meal, in breakfast → lunch → dinner → snack order:

| Meal      | Icon |
| --------- | ---- |
| Breakfast | 🌅   |
| Lunch     | ☀️   |
| Dinner    | 🌙   |
| Snack     | 🍎   |

**Where the data comes from:**

- Abbai Flow stores the plan as a `beacon_meal_plans` array in its data store (the Home Assistant add-on keeps it server-side; the standalone build keeps it in the browser). Each entry is `{ "date": "2026-11-07", "meal_type": "Dinner", "name": "Pasta pesto", "recipe_id": "..." }`.
- Meals are **written by a sync, not typed into Abbai Flow**. AnyList plans go through `scripts/sync-meals.ts`, which converts AnyList MCP output (or the plain `- **YYYY-MM-DD** [📖] Meal Name [MealType]` lines) into that JSON array. Grocy users get today's plan from `sensor.grocy_meal_plan` instead.
- The dashboard re-reads the store every 5 minutes, so a sync shows up without reloading the page.

**Key features:**

- **Per-day filtering** -- only entries whose `date` is today are shown; the list rolls over automatically at midnight.
- **Meal types** -- breakfast, lunch, dinner and snack each get their own icon.
- **Optional recipes** -- entries may carry a `recipe_id` for anything that links back to a recipe.

---

## Tasks

The tasks view shows todo items from Home Assistant's todo entities and Abbai Flow's built-in task list.

**Key features:**

- **Task list selector** -- switch between different HA todo lists.
- **Add tasks** -- type a task and press Enter or tap Add.
- **Mark complete** -- check off tasks to remove them from the active list.
- **Dashboard integration** -- outstanding tasks also appear on the Dashboard in the Tasks card.

### Desktop

![Tasks — desktop](images/tasks-desktop.png)

### Mobile

![Tasks — mobile](images/tasks-mobile.png)

---

## Music Controls

Control your Home Assistant media players directly from Abbai Flow.

**Key features:**

- **Player selector** -- choose which media player to control (e.g., Kitchen, Living Room).
- **Now playing** -- shows the current track, artist, and album art.
- **Transport controls** -- play/pause, previous, next.
- **Volume slider** -- adjust volume with a drag slider.
- **Mute button** -- quick mute toggle.

### Desktop

![Music — desktop](images/music-desktop.png)

### Mobile

![Music — mobile](images/music-mobile.png)

Music is accessible directly from the mobile bottom tab bar (no need to open the More menu).

---

## Weather

Real-time weather data from your Home Assistant weather entity.

**Key features:**

- **Current conditions** -- large temperature display with condition icon and description.
- **Detail cards** -- humidity, wind speed, and barometric pressure.
- **7-day forecast** -- each day shows the condition icon, high, and low temperatures.
- **Refresh button** -- manually re-fetch weather data from HA.

### Desktop

![Weather — desktop](images/weather-desktop.png)

### Mobile

![Weather — mobile](images/weather-mobile.png)

The 7-day forecast stacks vertically on mobile for easy scrolling.

---

## Settings

The settings view is where you configure Abbai Flow's behavior, appearance, and integrations.

**Key sections:**

- **Theme** -- choose from 8+ themes (Skylight, Midnight, Nord, Dracula, Monokai, Rose, Forest, and more). Auto dark mode switches between light and dark variants based on time of day.
- **Family Members** -- add, edit, or remove family members with custom avatars (55+ options), colors, and optional PINs.
- **Calendar Sources** -- manage which HA calendar entities appear in Abbai Flow.
- **List Providers** -- configure AnyList, HA Shopping List, or local list storage.
- **Weather Entity** -- set which `weather.*` entity powers the Weather view.
- **Display** -- screen saver timeout, photo slideshow interval, auto-refresh settings.

### Desktop

![Settings — desktop](images/settings-desktop.png)

### Mobile

![Settings — mobile](images/settings-mobile.png)

---

## Navigation: Desktop vs. Mobile

|                   | Desktop                                 | Mobile                                                    |
| ----------------- | --------------------------------------- | --------------------------------------------------------- |
| **Layout**        | Vertical icon sidebar on the left       | Bottom tab bar with 4 tabs + More                         |
| **Primary tabs**  | All views visible at once               | Dashboard, Calendar, Chores, Music                        |
| **Overflow**      | N/A (all visible)                       | More menu: Lists, Tasks, Photos, Timer, Weather, Settings |
| **Chore planner** | Full content column next to the sidebar | Scrolls below the header, own tab bar at the bottom       |

---

## Family Member Setup

1. Open **Settings** (gear icon at the bottom of the sidebar, or via More > Settings on mobile).
2. Find the **Family Members** section.
3. Tap **+ Add Member**.
4. Fill in:
   - **Name** -- the family member's display name
   - **Avatar** -- choose from 55+ emoji options across 5 categories (People, Animals, Nature, Fun, Food)
   - **Color** -- pick from 8 colors (blue, green, purple, orange, pink, teal, yellow, red)
   - **Role** -- Parent or Child
   - **PIN** (optional) -- a 4-6 digit numeric code
5. Tap **Add Member**.
6. Repeat for each family member.

Family members appear on the Dashboard chores panel, the Chore planner and in Calendar color-coding.

---

## Theme Selection

Abbai Flow ships with 8+ built-in themes:

| Theme          | Style                                         |
| -------------- | --------------------------------------------- |
| Skylight       | Clean, bright, modern (default)               |
| Midnight       | Dark blue with warm accents                   |
| Midnight Light | Light variant of Midnight                     |
| Nord           | Cool arctic tones from the Nord palette       |
| Dracula        | Dark purple with vibrant accents              |
| Monokai        | Dark with syntax-highlighting-inspired colors |
| Rose           | Soft pink and warm tones                      |
| Forest         | Deep green nature-inspired palette            |

To change themes:

1. Go to **Settings**.
2. Find the **Theme** selector.
3. Pick a theme -- the change applies immediately.
4. Enable **Auto Dark Mode** to automatically switch between light and dark variants based on time of day.

---

## Next Steps

- **[README](../README.md)** -- installation, features overview, and project info
- **[Changelog](../CHANGELOG.md)** -- release history
- **[Contributing](../CONTRIBUTING.md)** -- how to contribute to Abbai Flow
- **[Docs Site](./)** -- full documentation with detailed guides for every feature
