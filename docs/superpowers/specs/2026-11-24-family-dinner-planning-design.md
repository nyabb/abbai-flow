# Family Dinner Planning — Design

**Date:** 2026-11-24  
**Status:** Draft for review

## Purpose

Give the family one place to see tonight's dinner, plan the coming week, browse
recipes, and keep track of which meals the children like. Dinner plans and
recipes are shared by the household and remain available locally between
source refreshes.

## Decisions and scope

| Area           | Proposed decision                                                                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meals          | Dinner only in the first release.                                                                                                                                                                                                                   |
| Main view      | A dedicated Meals view opens on **Today**. Meals has its own navigation entry.                                                                                                                      |
| Planning       | A parent assigns one recipe to each date in the seven-day week view. A date can be left unplanned.                                                                                                                                                  |
| Unplanned day  | A parent can pick any catalog recipe for that date from Today; this creates that day's plan. No automatic recipe is chosen.                                                                                                                         |
| Child view     | Children can see today's meal and the week's plan, open recipe photos and steps, and rate a meal. They do not edit the plan or recipe catalog.                                                                                                      |
| Ratings        | Each family member can give a meal a 1–5 score; show the family average and individual scores. A member can update their own score.                                                                                                                 |
| Favorites      | A shared family favorites collection, visible and filterable in the catalog.                                                                                                                                                                        |
| Recipe sources | Configure the JSON source URL, optional bearer token, and field mapping in Settings → Integrations. Refresh it once per local calendar day, cache the returned menu/recipes, and expose a parent-only **Refresh now** action in Meals for recovery. |
| Local recipes  | Parents can create, edit, and delete recipes. Keep them separate from chore routines while using Abbai Flow's existing persistence layer.                                                                                                           |
| Meal history   | Keep past plans and ratings when a recipe is edited or removed; retain a small recipe snapshot with historical plans.                                                                                                                               |

## Existing meal-plan support

Abbai Flow already reads externally written entries from
`abbai_flow_meal_plans` for existing syncs. The new feature should extend this
flow instead of creating a second competing plan store. Keep existing records readable, preserve the existing key during
migration, and show only dinner in the new Meals views. Old breakfast, lunch,
and snack entries may remain in storage for compatibility but are not offered
for new plans. Existing third-party meal syncs can continue to write legacy
entries; parent-created plans in the app become the primary source for new
dinner features.

The new Meals screens must use the household's local date so the same dinner
appears across the family's devices.

## 1. Navigation and screens

Add a **Meals** area with these views:

- **Today** (default): the date, dinner title and photo, recipe steps, and any
  saved rating. If today's plan is empty, show a clear unplanned state and let a
  parent select a catalog recipe for today.
- **This week**: seven dates with the planned dinner, image, and a clear
  unplanned state. Parents can assign or replace a recipe per date here. The
  view follows the household's locale and local date; browsing another week
  must not change the current plan.
- **Recipes**: a searchable catalog with source/local labels, family favorites,
  and the average family score. Search covers recipe names and tags. Opening a
  recipe shows its photo, ingredients (when supplied), steps, and ratings.
- **Manage** (parent-facing): inspect source refresh status, edit local
  recipes, and manage weekly plans. Configure the source URL, optional bearer
  token, and data mapping in Settings → Integrations.

On a child's view, hide edit, delete, source, and planning controls. Opening
Meals still makes today's dinner the first thing shown.

## 2. Recipe and plan data

Each recipe needs a stable local ID, name, ordered steps, image reference,
source (feed or family), and optional ingredients and tags. Optional tags can
include cuisine or dietary labels; do not require nutrition data. Keep source
identity separately from the local ID so refreshed source records can be
matched without replacing family-created recipes.

A plan maps a local date to one recipe ID and records who last changed it. A
rating maps a local date and recipe to a family member ID and a 1–5 score. On a
shared screen, ask the child to choose their family profile before rating; do
not infer which child is holding the device. A favorite is shared household
state. If a recipe is deleted, preserve the name,
photo reference, and steps used by any past plan so history still renders.

Persist this data using Abbai Flow's existing server-backed data API in server
deployments and its local browser store in browser-only mode. Do not store
recipes by pretending they are chore/routine records: their lifecycle and
fields are different. Keep remote image URLs as references; show a local
placeholder if an image cannot load. Recipe records and plans themselves are
cached locally after each successful refresh.

## 3. Source refresh

The parent configures the source URL, optional bearer token, and mapping in
Settings → Integrations. Fetch the configured JSON feed once a day using the
household's local date and show the last successful refresh time and any error
in Meals → Manage. Send the token as an Authorization Bearer header from the
server; never return it to the browser. In a server deployment, schedule the
daily refresh on the server; in browser-only mode, refresh at most once per day
when the app is opened. Existing cached recipes and plans remain usable when
the source is unavailable.

Use the configured mapping to transform source records into Abbai Flow recipe
fields: item-array path, source ID, title, image, ingredients, ordered steps,
tags, menu date, and source URL. Paths use a small JSONPath-like subset: root
`$`, dotted property names, numeric array indexes, and `[]` array expansion;
filters and arbitrary expressions are not supported. The item-array, title,
and steps paths are required when a URL is configured. A menu date is optional
for recipe catalogs that do not supply a plan.

The parent confirms recipes from the fetched catalog when assigning dinners;
a feed refresh must never silently change an already planned dinner. Match
refreshed items by source-provided stable ID, falling back to a normalized
source URL. Do not overwrite a family's ratings, favorites, or plan history.
Show a useful error for a bad URL, inaccessible source, or unrecognized
response, and keep the last successful cache.

The source response must be JSON. A sample URL or sanitized response is still
needed to confirm that the mapping subset can represent the provider's shape.
Arbitrary HTML scraping is not guaranteed by this design.

## 4. Family interactions

- A parent selects recipes in the week view, one date at a time; leaving a day
  empty is allowed.
- On an unplanned date, a parent can use **Choose dinner** in Today to select a
  recipe. Saving it makes it visible to the whole family.
- Children can rate a recipe for the date it was served. Allow one score per
  family member per meal, with edits to that member's own score.
- Parents can create a recipe with a title and steps. Ingredients, image URL,
  and tags are optional; validate that the title and at least one step exist.
- The catalog can filter to favorites and search by name/tag. Ratings are
  summary information and do not determine which recipes can be planned.

## 5. Error and edge behavior

- A missing or failed daily fetch leaves the last good cache intact and does not
  clear planned meals.
- A source item that disappears is marked unavailable for future plans but
  remains readable in past plans.
- A missing image uses a placeholder without hiding recipe text or steps.
- A stale/unknown family member ID on a rating is retained as historical data
  and displayed without blocking other ratings.
- Two parent devices can edit the same date. Use the existing persistence
  behavior and show the currently saved plan after refresh; conflict merging is
  not part of this first release.

## Relevant additions and exclusions

Included because they complete the requested family flow: source refresh
status and recovery, local recipe creation, family-level favorites, per-child
ratings, empty/unplanned states, and retaining past plans after source changes.

Keep these out of the first release: breakfast/lunch, automatic meal selection,
AI-generated recipes, nutrition/calorie tracking, meal-prep schedules, grocery
list generation, public recipe sharing, and importing from arbitrary websites
without a defined response format. Ingredients are optional recipe detail; a
shopping-list integration can be designed separately later.

## Acceptance criteria

1. Today shows the planned dinner, recipe image, and ordered steps; an empty
   day is explicit and a parent can choose a recipe for it.
2. The week view shows seven local dates and lets a parent assign or replace
   each dinner without changing other dates.
3. Children can view the current week and recipe details but cannot change
   plans, source settings, or recipes.
4. Each family member can submit and update their 1–5 score for a meal; the
   catalog shows family favorites and aggregate scores.
5. A successful source refresh updates the cached catalog no more than once
   per day automatically, preserves plans and family data, and reports its
   status. A failed refresh keeps the last good cache.
6. A parent-created recipe appears in search and can be planned without being
   overwritten by source refreshes.
7. Historical plans and ratings remain readable after a recipe is removed.

## Open question

What exact URL and response shape will provide the recipes/menu? The generic
mapping is stored in Settings → Integrations, but a sample URL or sanitized
response is needed to verify its paths and the source's date/step formats.
