import { Ingredient } from './ingredient.model';

export interface RecipeIngredient {
  id?: string;
  dish_id?: string;
  ingredient_id: string;
  qty_per_person: number;
  ingredient?: Ingredient;
}
