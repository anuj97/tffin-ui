import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Ingredient } from '../models/ingredient.model';
import { InventoryItem } from '../models/inventory.model';
import { Dish } from '../models/dish.model';
import { MealSchedule, MealStockStatus, MealType, ShortageReportItem } from '../models/meal-schedule.model';

export function getTodayString(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

@Injectable({
  providedIn: 'root'
})
export class MealStoreService {
  private supabase = inject(SupabaseService);

  // State Signals
  public ingredients = signal<Ingredient[]>([]);
  public inventory = signal<InventoryItem[]>([]);
  public dishes = signal<Dish[]>([]);
  public schedules = signal<MealSchedule[]>([]);
  public isLoading = signal<boolean>(false);
  public lastError = signal<string | null>(null);
  public notification = signal<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  constructor() {
    this.init();
  }

  public async init(): Promise<void> {
    if (!this.supabase.hasClient) {
      this.clearState();
      return;
    }

    this.isLoading.set(true);
    try {
      await this.loadFromSupabase();
    } catch (err: any) {
      console.error('Failed to load from Supabase:', err);
      this.clearState();
    } finally {
      this.isLoading.set(false);
    }
  }

  public clearState(): void {
    this.ingredients.set([]);
    this.inventory.set([]);
    this.dishes.set([]);
    this.schedules.set([]);
  }

  public async loadFromSupabase(): Promise<void> {
    try {
      this.lastError.set(null);
      const [ings, invs, dshs] = await Promise.all([
        this.supabase.fetchIngredients(),
        this.supabase.fetchInventory(),
        this.supabase.fetchDishes()
      ]);

      this.ingredients.set(ings);
      this.inventory.set(invs);
      this.dishes.set(dshs);

      // Load schedule for +/- 14 days
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const end = new Date();
      end.setDate(end.getDate() + 14);

      const scheds = await this.supabase.fetchMealSchedule(
        start.toISOString().split('T')[0],
        end.toISOString().split('T')[0]
      );
      this.schedules.set(scheds);
    } catch (err: any) {
      this.lastError.set(err.message || 'Failed to load from Supabase');
      throw err;
    }
  }

  // Lookups
  public ingredientsMap = computed(() => {
    const map = new Map<string, Ingredient>();
    for (const ing of this.ingredients()) {
      map.set(ing.id, ing);
    }
    return map;
  });

  public dishesMap = computed(() => {
    const map = new Map<string, Dish>();
    for (const d of this.dishes()) {
      map.set(d.id, d);
    }
    return map;
  });

  public inventoryMap = computed(() => {
    const map = new Map<string, InventoryItem>();
    for (const inv of this.inventory()) {
      map.set(inv.ingredient_id, inv);
    }
    return map;
  });

  // Enriched Inventory Items
  public enrichedInventory = computed(() => {
    const ingMap = this.ingredientsMap();
    return this.inventory().map(inv => {
      const ing = ingMap.get(inv.ingredient_id);
      const isLow = Number(inv.quantity) <= Number(inv.min_threshold);
      const pct = inv.min_threshold > 0 
        ? Math.min(100, Math.round((inv.quantity / (inv.min_threshold * 2)) * 100))
        : 100;

      return {
        ...inv,
        ingredient: ing,
        isLowStock: isLow,
        stockPercentage: pct
      };
    });
  });

  public lowStockItems = computed(() => {
    return this.enrichedInventory().filter(i => i.isLowStock);
  });

  public lowStockCount = computed(() => {
    return this.lowStockItems().length;
  });

  // Today's Meals with Feasibility Check
  public todayMeals = computed(() => {
    const today = getTodayString();
    return this.getMealsForDate(today);
  });

  public getMealsForDate(dateStr: string) {
    const daySchedules = this.schedules().filter(s => s.schedule_date === dateStr);
    const dMap = this.dishesMap();

    const types: MealType[] = ['breakfast', 'lunch', 'dinner'];
    return types.map(type => {
      const meal = daySchedules.find(s => s.meal_type === type);
      const dish = meal ? dMap.get(meal.dish_id) : undefined;
      const stockStatus = meal && dish ? this.calculateMealStockStatus(dish, meal.headcount) : null;

      return {
        mealType: type,
        schedule: meal || null,
        dish: dish || null,
        stockStatus
      };
    });
  }

  // Stock status calculation for a given dish and headcount
  public calculateMealStockStatus(dish: Dish, headcount: number): MealStockStatus {
    const invMap = this.inventoryMap();
    const ingMap = this.ingredientsMap();
    const missing: { ingredientName: string; deficit: number; unit: string }[] = [];

    if (!dish.recipe_ingredients || dish.recipe_ingredients.length === 0) {
      return { isFullyStocked: true, missingItems: [] };
    }

    for (const ri of dish.recipe_ingredients) {
      const needed = Number(ri.qty_per_person) * headcount;
      const onHand = Number(invMap.get(ri.ingredient_id)?.quantity || 0);
      const ing = ingMap.get(ri.ingredient_id);

      if (onHand < needed) {
        missing.push({
          ingredientName: ing ? ing.name : 'Unknown Ingredient',
          deficit: Math.round((needed - onHand) * 10) / 10,
          unit: ing ? ing.unit : 'unit'
        });
      }
    }

    return {
      isFullyStocked: missing.length === 0,
      missingItems: missing
    };
  }

  // Smart Grocery Shortage List for upcoming N days
  public calculateShortages(daysAhead: number = 4): ShortageReportItem[] {
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + daysAhead);

    const todayStr = today.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const targetSchedules = this.schedules().filter(
      s => s.schedule_date >= todayStr && s.schedule_date <= endStr
    );

    const ingMap = this.ingredientsMap();
    const invMap = this.inventoryMap();
    const dMap = this.dishesMap();

    // Sum required quantities per ingredient
    const requiredMap = new Map<string, number>();

    for (const sched of targetSchedules) {
      const dish = dMap.get(sched.dish_id);
      if (dish && dish.recipe_ingredients) {
        for (const ri of dish.recipe_ingredients) {
          const totalForMeal = Number(ri.qty_per_person) * sched.headcount;
          const current = requiredMap.get(ri.ingredient_id) || 0;
          requiredMap.set(ri.ingredient_id, current + totalForMeal);
        }
      }
    }

    const shortages: ShortageReportItem[] = [];

    requiredMap.forEach((requiredQty, ingredientId) => {
      const onHand = Number(invMap.get(ingredientId)?.quantity || 0);
      if (onHand < requiredQty) {
        const ing = ingMap.get(ingredientId);
        shortages.push({
          ingredientId,
          ingredientName: ing ? ing.name : 'Unknown',
          category: ing ? ing.category : 'staples',
          unit: ing ? ing.unit : 'g',
          requiredQty: Math.round(requiredQty * 10) / 10,
          availableQty: Math.round(onHand * 10) / 10,
          deficit: Math.round((requiredQty - onHand) * 10) / 10
        });
      }
    });

    return shortages.sort((a, b) => b.deficit - a.deficit);
  }

  // State Mutations with Optimistic Updates
  public async adjustHeadcount(scheduleDate: string, mealType: MealType, delta: number): Promise<void> {
    if (!this.supabase.hasClient) {
      this.showNotification('Supabase connection missing. Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.', 'error');
      return;
    }

    // 1. Optimistic local update
    const current = this.schedules();
    const existingIndex = current.findIndex(
      s => s.schedule_date === scheduleDate && s.meal_type === mealType
    );

    if (existingIndex >= 0) {
      const target = current[existingIndex];
      const newCount = Math.max(0, target.headcount + delta);
      const updated = [...current];
      updated[existingIndex] = { ...target, headcount: newCount };
      this.schedules.set(updated);

      // 2. Call Supabase RPC
      try {
        await this.supabase.updateHeadcountRPC(scheduleDate, mealType, delta);
      } catch (err: any) {
        this.showNotification(`Error updating headcount: ${err.message}`, 'error');
        // Revert on failure
        this.schedules.set(current);
      }
    }
  }

  public async setMealSchedule(
    schedule_date: string,
    meal_type: MealType,
    dish_id: string,
    headcount: number = 3
  ): Promise<void> {
    if (!this.supabase.hasClient) {
      this.showNotification('Supabase connection missing. Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.', 'error');
      return;
    }

    try {
      const saved = await this.supabase.upsertMealSchedule(schedule_date, meal_type, dish_id, headcount);
      const current = this.schedules();
      const existingIndex = current.findIndex(
        s => s.schedule_date === schedule_date && s.meal_type === meal_type
      );

      if (existingIndex >= 0) {
        const list = [...current];
        list[existingIndex] = { ...current[existingIndex], dish_id, headcount };
        this.schedules.set(list);
      } else {
        this.schedules.set([...current, saved]);
      }
      this.showNotification(`Meal scheduled for ${meal_type} on ${schedule_date}`, 'success');
    } catch (err: any) {
      this.showNotification(`Error saving schedule: ${err.message}`, 'error');
    }
  }

  public async updateInventoryQuantity(ingredientId: string, newQuantity: number, minThreshold?: number): Promise<void> {
    if (!this.supabase.hasClient) {
      this.showNotification('Supabase connection missing. Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.', 'error');
      return;
    }

    const current = this.inventory();
    const idx = current.findIndex(i => i.ingredient_id === ingredientId);

    if (idx >= 0) {
      const item = { ...current[idx] };
      item.quantity = Math.max(0, newQuantity);
      if (minThreshold !== undefined) {
        item.min_threshold = minThreshold;
      }
      item.updated_at = new Date().toISOString();

      const updated = [...current];
      updated[idx] = item;
      this.inventory.set(updated);

      try {
        await this.supabase.updateInventory(ingredientId, item.quantity, item.min_threshold);
      } catch (err: any) {
        this.showNotification(`Error updating inventory: ${err.message}`, 'error');
        this.inventory.set(current);
      }
    }
  }

  public async adjustInventoryDelta(ingredientId: string, delta: number): Promise<void> {
    const currentItem = this.inventory().find(i => i.ingredient_id === ingredientId);
    if (currentItem) {
      const newQty = Math.max(0, currentItem.quantity + delta);
      await this.updateInventoryQuantity(ingredientId, newQty);
    }
  }

  public async createIngredient(
    name: string,
    category: string,
    unit: string,
    initialStock: number = 0,
    minThreshold: number = 0
  ): Promise<void> {
    if (!this.supabase.hasClient) {
      this.showNotification('Supabase connection missing. Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.', 'error');
      return;
    }

    try {
      const newIng = await this.supabase.createIngredient(
        { name, category, unit },
        initialStock,
        minThreshold
      );
      this.ingredients.set([...this.ingredients(), newIng]);
      this.inventory.set([
        ...this.inventory(),
        {
          id: 'inv-' + Date.now(),
          ingredient_id: newIng.id,
          quantity: initialStock,
          min_threshold: minThreshold,
          updated_at: new Date().toISOString()
        }
      ]);
      this.showNotification(`Added ingredient: ${name}`, 'success');
    } catch (err: any) {
      this.showNotification(`Failed to create ingredient: ${err.message}`, 'error');
    }
  }

  public async createDish(
    name: string,
    cookNotes: string,
    recipeIngredients: { ingredient_id: string; qty_per_person: number }[]
  ): Promise<void> {
    if (!this.supabase.hasClient) {
      this.showNotification('Supabase connection missing. Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.', 'error');
      return;
    }

    try {
      await this.supabase.createDish({ name, cook_notes: cookNotes }, recipeIngredients);
      const dishes = await this.supabase.fetchDishes();
      this.dishes.set(dishes);
      this.showNotification(`Created dish: ${name}`, 'success');
    } catch (err: any) {
      this.showNotification(`Failed to create dish: ${err.message}`, 'error');
    }
  }

  public async deleteDish(dishId: string): Promise<void> {
    if (!this.supabase.hasClient) {
      this.showNotification('Supabase connection missing. Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.', 'error');
      return;
    }

    try {
      await this.supabase.deleteDish(dishId);
      this.dishes.set(this.dishes().filter(d => d.id !== dishId));
      this.showNotification('Dish removed', 'info');
    } catch (err: any) {
      this.showNotification(`Failed to delete dish: ${err.message}`, 'error');
    }
  }

  public async quickRestockAll(shortages: ShortageReportItem[]): Promise<void> {
    for (const item of shortages) {
      const currentItem = this.inventory().find(i => i.ingredient_id === item.ingredientId);
      const currentQty = currentItem ? currentItem.quantity : 0;
      // Add deficit + 50% buffer
      const buffer = Math.round(item.deficit * 1.5);
      await this.updateInventoryQuantity(item.ingredientId, currentQty + buffer);
    }
    this.showNotification(`Restocked ${shortages.length} shortage items successfully!`, 'success');
  }

  public showNotification(message: string, type: 'success' | 'info' | 'error' = 'info'): void {
    this.notification.set({ message, type });
    setTimeout(() => {
      this.notification.set(null);
    }, 4000);
  }
}
