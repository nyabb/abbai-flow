#!/usr/bin/env node
/**
 * Parses AnyList meal plan MCP output into MealPlanEntry[] JSON.
 *
 * Usage:
 *   node --experimental-strip-types scripts/sync-meals.ts < meal-data.txt > meal-plans.json
 *   node --experimental-strip-types scripts/sync-meals.ts meal-data.txt > meal-plans.json
 *   node --experimental-strip-types scripts/sync-meals.ts meal-data.txt --from 2026-03-31 --to 2026-04-15
 *
 * Input: the raw JSON array from the MCP tool-results file, or plain text
 *        with one event per line in the format:
 *        - **YYYY-MM-DD** [📖] Meal Name [MealType] [— notes] (id: xxx)
 *
 * Output: JSON array of { date, meal_type, name, recipe_id? }
 *
 * Node 22.6+ strips the types at load time, so the script runs directly — no
 * build step and no `.mjs` copy to keep in sync.
 */

import { readFileSync } from 'node:fs';

interface MealPlanEntry {
  date: string;
  meal_type: string;
  name: string;
  recipe_id?: string;
}

// --- Parse CLI args ---
const args = process.argv.slice(2);
let inputFile: string | null = null;
let fromDate: string | null = null;
let toDate: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from' && args[i + 1]) {
    fromDate = args[++i];
  } else if (args[i] === '--to' && args[i + 1]) {
    toDate = args[++i];
  } else if (!args[i].startsWith('-')) {
    inputFile = args[i];
  }
}

// Default: current week start (Monday) through +2 weeks
if (!fromDate || !toDate) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);

  const endSunday = new Date(monday);
  endSunday.setDate(monday.getDate() + 20); // 3 weeks minus 1 day

  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  fromDate = fromDate || fmt(monday);
  toDate = toDate || fmt(endSunday);
}

// --- Read input ---
const raw: string = inputFile
  ? readFileSync(inputFile, 'utf-8')
  : readFileSync('/dev/stdin', 'utf-8');

// If input is JSON (MCP tool-results wrapper), extract the text field
let text: string;
try {
  const parsed: unknown = JSON.parse(raw);
  const first = Array.isArray(parsed) ? (parsed[0] as { text?: unknown } | undefined) : undefined;
  text = typeof first?.text === 'string' ? first.text : raw;
} catch {
  text = raw;
}

// --- Parse events ---
// Format: - **YYYY-MM-DD** [📖 ]Meal Name [MealType] [— notes] (id: hex)
const lineRe = /^- \*\*(\d{4}-\d{2}-\d{2})\*\*\s+(?:📖\s+)?(.+?)\s+\(id:\s*([0-9a-f]+)\)\s*$/;
const mealTypeRe = /\[(Breakfast|Lunch|Dinner)\]/i;
const notesRe = /\s+—\s+(.+)$/;

const entries: MealPlanEntry[] = [];

for (const line of text.split('\n')) {
  const m = line.match(lineRe);
  if (!m) continue;

  const [, date, rest, id] = m;

  // Date filter
  if (date < fromDate || date > toDate) continue;

  let name = rest.trim();

  // Extract meal type
  const typeMatch = name.match(mealTypeRe);
  const meal_type = typeMatch ? typeMatch[1] : 'Dinner';
  name = name.replace(mealTypeRe, '').trim();

  // Strip notes after em-dash
  const notesMatch = name.match(notesRe);
  if (notesMatch) {
    name = name.replace(notesRe, '').trim();
  }

  // Detect recipe (has 📖 in original line)
  const hasRecipe = line.includes('📖');

  const entry: MealPlanEntry = { date, meal_type, name };
  if (hasRecipe) entry.recipe_id = id;

  entries.push(entry);
}

process.stdout.write(JSON.stringify(entries, null, 2) + '\n');

if (process.stderr.isTTY) {
  process.stderr.write(`Parsed ${entries.length} meals from ${fromDate} to ${toDate}\n`);
}
