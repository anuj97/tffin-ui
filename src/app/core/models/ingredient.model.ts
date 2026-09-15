export type IngredientCategory = 'produce' | 'dairy' | 'spices' | 'staples' | string;
export type MeasurementUnit = 'g' | 'kg' | 'pcs' | 'ml' | string;

export interface Ingredient {
  id: string;
  name: string;
  category: IngredientCategory;
  unit: MeasurementUnit;
}
