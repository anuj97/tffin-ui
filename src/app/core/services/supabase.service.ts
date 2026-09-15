import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Ingredient } from '../models/ingredient.model';
import { InventoryItem } from '../models/inventory.model';
import { Dish } from '../models/dish.model';
import { MealSchedule, MealType } from '../models/meal-schedule.model';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isDemoMode: boolean;
}

const STORAGE_KEY = 'tffin_supabase_config';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private client: SupabaseClient | null = null;

  public config = signal<SupabaseConfig>(this.loadConfig());
  public isConnected = signal<boolean>(false);
  public connectionError = signal<string | null>(null);

  constructor() {
    this.initializeClient();
  }

  private loadConfig(): SupabaseConfig {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to parse saved Supabase configuration:', e);
    }

    return {
      url: '',
      anonKey: '',
      isDemoMode: true
    };
  }

  public saveConfig(config: SupabaseConfig): void {
    this.config.set(config);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.error('Failed to save config to local storage', e);
    }
    this.initializeClient();
  }

  private initializeClient(): void {
    const current = this.config();
    if (!current.isDemoMode && current.url && current.anonKey) {
      try {
        this.client = createClient(current.url, current.anonKey);
        this.testConnection();
      } catch (err: any) {
        this.isConnected.set(false);
        this.connectionError.set(err.message || 'Failed to initialize Supabase client');
      }
    } else {
      this.client = null;
      this.isConnected.set(false);
      this.connectionError.set(null);
    }
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.client) {
      return { success: false, error: 'No active Supabase client configured.' };
    }

    try {
      const { data, error } = await this.client.from('ingredients').select('id').limit(1);
      if (error) {
        this.isConnected.set(false);
        this.connectionError.set(error.message);
        return { success: false, error: error.message };
      }
      this.isConnected.set(true);
      this.connectionError.set(null);
      return { success: true };
    } catch (err: any) {
      this.isConnected.set(false);
      this.connectionError.set(err.message || 'Unknown network error');
      return { success: false, error: err.message };
    }
  }

  public get isDemo(): boolean {
    return this.config().isDemoMode || !this.client;
  }

  // Database Access Methods
  public async fetchIngredients(): Promise<Ingredient[]> {
    if (!this.client) return [];
    const { data, error } = await this.client.from('ingredients').select('*').order('name');
    if (error) throw error;
    return data || [];
  }

  public async fetchInventory(): Promise<InventoryItem[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('inventory')
      .select('*, ingredient:ingredients(*)')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  public async fetchDishes(): Promise<Dish[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('dishes')
      .select(`
        id,
        name,
        cook_notes,
        recipe_ingredients (
          id,
          ingredient_id,
          qty_per_person,
          ingredient:ingredients(*)
        )
      `)
      .order('name');
    if (error) throw error;
    return (data as unknown as Dish[]) || [];
  }

  public async fetchMealSchedule(startDate: string, endDate: string): Promise<MealSchedule[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('meal_schedule')
      .select(`
        id,
        schedule_date,
        meal_type,
        dish_id,
        headcount,
        dish:dishes(
          id,
          name,
          cook_notes,
          recipe_ingredients (
            ingredient_id,
            qty_per_person,
            ingredient:ingredients(*)
          )
        )
      `)
      .gte('schedule_date', startDate)
      .lte('schedule_date', endDate)
      .order('schedule_date');
    if (error) throw error;
    return (data as unknown as MealSchedule[]) || [];
  }

  // Mutations
  public async updateHeadcountRPC(date: string, meal: MealType, delta: number): Promise<number> {
    if (!this.client) throw new Error('Supabase client not active');
    const { data, error } = await this.client.rpc('update_meal_headcount', {
      p_date: date,
      p_meal: meal,
      p_delta: delta
    });
    if (error) throw error;
    return data as number;
  }

  public async upsertMealSchedule(
    schedule_date: string,
    meal_type: MealType,
    dish_id: string,
    headcount: number
  ): Promise<MealSchedule> {
    if (!this.client) throw new Error('Supabase client not active');
    const { data, error } = await this.client
      .from('meal_schedule')
      .upsert(
        { schedule_date, meal_type, dish_id, headcount },
        { onConflict: 'schedule_date,meal_type' }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  public async updateInventory(ingredient_id: string, quantity: number, min_threshold?: number): Promise<void> {
    if (!this.client) throw new Error('Supabase client not active');
    const payload: any = {
      ingredient_id,
      quantity,
      updated_at: new Date().toISOString()
    };
    if (min_threshold !== undefined) {
      payload.min_threshold = min_threshold;
    }
    const { error } = await this.client
      .from('inventory')
      .upsert(payload, { onConflict: 'ingredient_id' });
    if (error) throw error;
  }

  public async createIngredient(ingredient: Omit<Ingredient, 'id'>, initialStock: number = 0, minThreshold: number = 0): Promise<Ingredient> {
    if (!this.client) throw new Error('Supabase client not active');
    const { data: ingData, error: ingError } = await this.client
      .from('ingredients')
      .insert(ingredient)
      .select()
      .single();
    if (ingError) throw ingError;

    // Create inventory record
    await this.client.from('inventory').insert({
      ingredient_id: ingData.id,
      quantity: initialStock,
      min_threshold: minThreshold
    });

    return ingData;
  }

  public async createDish(dish: { name: string; cook_notes?: string }, ingredients: { ingredient_id: string; qty_per_person: number }[]): Promise<void> {
    if (!this.client) throw new Error('Supabase client not active');
    const { data: dishData, error: dishError } = await this.client
      .from('dishes')
      .insert(dish)
      .select()
      .single();
    if (dishError) throw dishError;

    if (ingredients.length > 0) {
      const rows = ingredients.map(ing => ({
        dish_id: dishData.id,
        ingredient_id: ing.ingredient_id,
        qty_per_person: ing.qty_per_person
      }));
      const { error: ingError } = await this.client.from('recipe_ingredients').insert(rows);
      if (ingError) throw ingError;
    }
  }

  public async deleteDish(dishId: string): Promise<void> {
    if (!this.client) throw new Error('Supabase client not active');
    const { error } = await this.client.from('dishes').delete().eq('id', dishId);
    if (error) throw error;
  }
}
