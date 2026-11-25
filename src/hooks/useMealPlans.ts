import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { loadData, loadDataSync } from '../api/abbai-flow-store';
import { MealPlanEntry, DayMenu } from '../types/meals';

const STORAGE_KEY = 'abbai_flow_meal_plans';
const REFRESH_INTERVAL = 5 * 60 * 1000; // re-read store every 5 min

/**
 * Reads meal plan entries from the Abbai Flow storage.
 * Data is written externally (MCP sync, CLI script, etc.).
 */
export function useMealPlans() {
  const [entries, setEntries] = useState<MealPlanEntry[]>(() =>
    loadDataSync<MealPlanEntry[]>(STORAGE_KEY, []),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = () => {
      void loadData<MealPlanEntry[]>(STORAGE_KEY, [])
        .then((loadedEntries) => {
          if (active) setEntries(loadedEntries);
        })
        .catch(() => undefined)
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    load();
    const interval = setInterval(load, REFRESH_INTERVAL);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const todaysMenu: DayMenu = useMemo(() => {
    const meals = entries
      .filter((e) => e.date === todayStr)
      .sort((a, b) => {
        const order = { Breakfast: 0, Lunch: 1, Dinner: 2, Snack: 3 };
        return (order[a.meal_type] ?? 4) - (order[b.meal_type] ?? 4);
      });
    return { date: todayStr, meals };
  }, [entries, todayStr]);

  return { entries, todaysMenu, loading };
}
