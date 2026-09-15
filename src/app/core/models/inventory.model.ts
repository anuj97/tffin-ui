import { Ingredient } from './ingredient.model';

export interface InventoryItem {
  id: string;
  ingredient_id: string;
  quantity: number;
  min_threshold: number;
  updated_at?: string;
  ingredient?: Ingredient;
}

export interface InventoryStatus extends InventoryItem {
  isLowStock: boolean;
  stockPercentage: number;
}
