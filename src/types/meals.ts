export type MealType = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';

export interface MealPlanEntry {
  date: string;       // YYYY-MM-DD
  meal_type: MealType;
  name: string;
  recipe_id?: string;
  image_url?: string;
  ingredients?: string[];
  steps?: string[];
  tags?: string[];
  source_url?: string;
}

export interface DayMenu {
  date: string;
  meals: MealPlanEntry[];
}
