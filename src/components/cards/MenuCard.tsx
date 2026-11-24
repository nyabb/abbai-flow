import { DashboardCardProps } from '../../types/dashboard-cards';
import { MealType } from '../../types/meals';
import { useTranslation } from '../../i18n';

const MEAL_ICONS: Record<MealType, string> = {
  Breakfast: '🌅',
  Lunch: '☀️',
  Dinner: '🌙',
  Snack: '🍎',
};

/** Sidebar "Menu" section — today's meal plan. */
export function MenuCard({ context }: DashboardCardProps) {
  const { t } = useTranslation();
  const { todaysMenu } = context;
  const dinners = todaysMenu.meals.filter((meal) => meal.meal_type === 'Dinner');

  return (
    <section className="dash-sidebar-section">
      <div className="dash-menu-heading-row">
        <h3 className="dash-sidebar-heading">{t('dashboard.menu')}</h3>
        {context.onOpenMeals && (
          <button
            type="button"
            className="dash-menu-open"
            onClick={context.onOpenMeals}
            aria-label={t('dashboard.openMeals')}
          >
            {t('dashboard.openMeals')}
          </button>
        )}
      </div>
      {dinners.length > 0 ? (
        <ul className="dash-menu-list">
          {dinners.map((meal, i) => (
            <li key={meal.recipe_id || `${meal.date}-${meal.name}-${i}`} className="dash-menu-item">
              <span className="dash-menu-icon">{MEAL_ICONS.Dinner}</span>
              <div className="dash-menu-info">
                <span className="dash-menu-type">{t('meals.dinner')}</span>
                <span className="dash-menu-name">{meal.name}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dash-menu-empty">{t('dashboard.noDinnerPlanned')}</p>
      )}
    </section>
  );
}
