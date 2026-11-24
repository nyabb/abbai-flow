import { useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfDay, startOfWeek } from 'date-fns';
import { loadIntegrationSettings, type IntegrationSettingsStatus } from '../api/integration-settings';
import { getRuntimeConfig } from '../config';
import { useMealPlans } from '../hooks/useMealPlans';
import type { MealPlanEntry } from '../types/meals';
import { useTranslation } from '../i18n';

type MealTab = 'today' | 'week' | 'recipes' | 'manage';

interface MealsViewProps {
  weekStartsOn: 0 | 1;
  onOpenSettings: () => void;
}

function mealKey(meal: MealPlanEntry): string {
  return meal.recipe_id || meal.name.trim().toLocaleLowerCase();
}

function RecipeDetails({ meal }: { meal: MealPlanEntry }) {
  const { t } = useTranslation();

  return (
    <article className="meal-card">
      {meal.image_url ? (
        <img
          className="meal-card-image"
          src={meal.image_url}
          alt={meal.name}
          loading="lazy"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : (
        <div className="meal-card-image meal-card-image--placeholder" aria-hidden="true">
          🍽️
        </div>
      )}
      <div className="meal-card-content">
        <h3>{meal.name}</h3>
        {meal.ingredients?.length ? (
          <div className="meal-card-section">
            <h4>{t('meals.ingredients')}</h4>
            <ul>
              {meal.ingredients.map((ingredient, index) => (
                <li key={`${index}-${ingredient}`}>{ingredient}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {meal.steps?.length ? (
          <div className="meal-card-section">
            <h4>{t('meals.steps')}</h4>
            <ol>
              {meal.steps.map((step, index) => (
                <li key={`${index}-${step}`}>{step}</li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="meal-muted">{t('meals.recipeDetailsUnavailable')}</p>
        )}
        {meal.tags?.length ? (
          <div className="meal-tags">
            {meal.tags.map((tag) => (
              <span className="meal-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function MealsView({ weekStartsOn, onOpenSettings }: MealsViewProps) {
  const { t, dateLocale } = useTranslation();
  const { entries } = useMealPlans();
  const [tab, setTab] = useState<MealTab>('today');
  const [search, setSearch] = useState('');
  const [sourceStatus, setSourceStatus] = useState<IntegrationSettingsStatus | null>(null);
  const serverBacked = Boolean(getRuntimeConfig());

  useEffect(() => {
    if (!serverBacked) return;
    loadIntegrationSettings()
      .then(setSourceStatus)
      .catch(() => setSourceStatus(null));
  }, [serverBacked]);

  const today = startOfDay(new Date());
  const todayKey = format(today, 'yyyy-MM-dd');
  const dinnerEntries = useMemo(
    () => entries.filter((entry) => entry.meal_type === 'Dinner'),
    [entries],
  );
  const todayDinners = dinnerEntries.filter((entry) => entry.date === todayKey);
  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(today, { weekStartsOn });
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }, [today, weekStartsOn]);
  const recipes = useMemo(() => {
    const unique = new Map<string, MealPlanEntry>();
    for (const entry of dinnerEntries) {
      if (!unique.has(mealKey(entry))) unique.set(mealKey(entry), entry);
    }
    return Array.from(unique.values());
  }, [dinnerEntries]);
  const filteredRecipes = recipes.filter((recipe) =>
    `${recipe.name} ${(recipe.tags || []).join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  const tabs: { id: MealTab; label: string }[] = [
    { id: 'today', label: t('meals.today') },
    { id: 'week', label: t('meals.thisWeek') },
    { id: 'recipes', label: t('meals.recipes') },
    { id: 'manage', label: t('meals.manage') },
  ];

  return (
    <div className="meals-view">
      <div className="meals-tabs" role="tablist" aria-label={t('nav.meals')}>
        {tabs.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`meals-tab ${tab === item.id ? 'meals-tab--active' : ''}`}
            key={item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <section className="meals-panel" aria-labelledby="meals-today-heading">
          <div className="meals-panel-heading">
            <div>
              <h2 id="meals-today-heading">{t('meals.dinner')}</h2>
              <p>{format(today, 'EEEE, d MMMM', { locale: dateLocale })}</p>
            </div>
          </div>
          {todayDinners.length ? (
            <div className="meals-list">
              {todayDinners.map((meal, index) => (
                <RecipeDetails key={meal.recipe_id || `${meal.name}-${index}`} meal={meal} />
              ))}
            </div>
          ) : (
            <div className="meals-empty">
              <span className="meals-empty-icon" aria-hidden="true">
                🍽️
              </span>
              <h3>{t('meals.noDinnerPlanned')}</h3>
              <p>{t('meals.noDinnerPlannedHelp')}</p>
              <button type="button" className="settings-btn" onClick={() => setTab('manage')}>
                {t('meals.sourceSettings')}
              </button>
            </div>
          )}
        </section>
      )}

      {tab === 'week' && (
        <section className="meals-week" aria-label={t('meals.thisWeek')}>
          {weekDays.map((day) => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const dinners = dinnerEntries.filter((entry) => entry.date === dayKey);
            return (
              <article className="meal-day-card" key={dayKey}>
                <div className="meal-day-heading">
                  <h2>{format(day, 'EEEE', { locale: dateLocale })}</h2>
                  <time dateTime={dayKey}>{format(day, 'd MMM', { locale: dateLocale })}</time>
                </div>
                {dinners.length ? (
                  dinners.map((meal, index) => (
                    <div className="meal-day-entry" key={meal.recipe_id || `${meal.name}-${index}`}>
                      {meal.image_url && (
                        <img src={meal.image_url} alt="" loading="lazy" onError={(event) => {
                          event.currentTarget.hidden = true;
                        }} />
                      )}
                      <span>{meal.name}</span>
                    </div>
                  ))
                ) : (
                  <p className="meal-muted">{t('meals.unplanned')}</p>
                )}
              </article>
            );
          })}
        </section>
      )}

      {tab === 'recipes' && (
        <section className="meals-panel" aria-labelledby="meals-recipes-heading">
          <div className="meals-panel-heading">
            <div>
              <h2 id="meals-recipes-heading">{t('meals.recipes')}</h2>
              <p>{t('meals.catalogFromPlans')}</p>
            </div>
            <input
              className="meals-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('meals.searchRecipes')}
              aria-label={t('meals.searchRecipes')}
            />
          </div>
          {filteredRecipes.length ? (
            <div className="meals-recipe-grid">
              {filteredRecipes.map((recipe) => (
                <RecipeDetails key={mealKey(recipe)} meal={recipe} />
              ))}
            </div>
          ) : (
            <div className="meals-empty">
              <h3>{t('meals.noRecipes')}</h3>
              <p>{t('meals.noRecipesHelp')}</p>
            </div>
          )}
        </section>
      )}

      {tab === 'manage' && (
        <section className="meals-panel" aria-labelledby="meals-manage-heading">
          <div className="meals-panel-heading">
            <div>
              <h2 id="meals-manage-heading">{t('meals.sourceSettings')}</h2>
              <p>{t('meals.sourceSettingsHelp')}</p>
            </div>
          </div>
          {serverBacked ? (
            sourceStatus?.mealSourceUrl ? (
              <div className="meal-source-card">
                <span className="meal-source-status">{t('meals.sourceConfigured')}</span>
                <a href={sourceStatus.mealSourceUrl} target="_blank" rel="noreferrer">
                  {sourceStatus.mealSourceUrl}
                </a>
                <p>
                  {sourceStatus.mealSourceTokenConfigured
                    ? t('meals.bearerConfigured')
                    : t('meals.bearerNotConfigured')}
                </p>
                <p>{t('meals.sourceSettingsHelp')}</p>
              </div>
            ) : (
              <div className="meals-empty">
                <h3>{t('meals.sourceNotConfigured')}</h3>
                <p>{t('meals.sourceSettingsHelp')}</p>
              </div>
            )
          ) : (
            <div className="meals-empty">
              <p>{t('settings.integrations.mealSourceBackendRequired')}</p>
            </div>
          )}
          <button type="button" className="settings-btn settings-btn--primary" onClick={onOpenSettings}>
            {t('meals.openSettings')}
          </button>
        </section>
      )}
    </div>
  );
}
