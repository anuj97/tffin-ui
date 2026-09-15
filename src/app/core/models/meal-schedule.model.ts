import { Dish } from './dish.model';
import { Ingredient } from './ingredient.model';

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface MealSchedule {
  id: string;
  schedule_date: string; // YYYY-MM-DD
  meal_type: MealType;
  dish_id: string;
  headcount: number;
  dish?: Dish;
}

export interface ShortageReportItem {
  ingredientId: string;
  ingredientName: string;
  category: string;
  unit: string;
  requiredQty: number;
  availableQty: number;
  deficit: number;
}

export interface MealStockStatus {
  isFullyStocked: boolean;
  missingItems: {
    ingredientName: string;
    deficit: number;
    unit: string;
  }[];
}
