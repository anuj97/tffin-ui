import { RecipeIngredient } from './recipe.model';

export interface Dish {
  id: string;
  name: string;
  cook_notes?: string | null;
  household_id?: string | null;
  recipe_ingredients?: RecipeIngredient[];
}
