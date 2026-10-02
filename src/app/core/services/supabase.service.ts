import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Ingredient } from '../models/ingredient.model';
import { InventoryItem } from '../models/inventory.model';
import { Dish } from '../models/dish.model';
import { MealSchedule, MealType } from '../models/meal-schedule.model';
import { Household, HouseholdMember, HouseholdInvitation } from '../models/household.model';
import { AppUser } from '../models/user.model';

export interface SupabaseConfig {
  url: string;
  key: string;
}

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private client: SupabaseClient | null = null;

  public config = signal<SupabaseConfig>({
    url: (environment.supabaseUrl || '').trim(),
    key: ((environment as any).supabaseKey || environment.supabaseAnonKey || '').trim()
  });
  public isConnected = signal<boolean>(false);
  public connectionError = signal<string | null>(null);

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    const current = this.config();
    if (current.url && current.key) {
      try {
        this.client = createClient(current.url, current.key, {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        });
        this.testConnection();
      } catch (err: any) {
        this.isConnected.set(false);
        this.connectionError.set(err.message || 'Failed to initialize Supabase client');
      }
    } else {
      this.client = null;
      this.isConnected.set(false);
      this.connectionError.set(
        'Supabase environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are not configured.'
      );
    }
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.client) {
      return { success: false, error: 'No active Supabase client configured. Check environment variables.' };
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

  public get hasClient(): boolean {
    return !!this.client;
  }

  // Authentication Verification
  public async verifyUserCredentials(username: string, password: string): Promise<AppUser | null> {
    if (!this.client) {
      throw new Error('Supabase client is not configured. Please check environment variables.');
    }

    const { data, error } = await this.client.rpc('verify_app_user', {
      p_username: username.trim(),
      p_password: password
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      return null;
    }

    const row = data[0];
    const hhIds: string[] = Array.isArray(row.household_ids)
      ? row.household_ids
      : (row.household_id ? [row.household_id] : []);

    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name || 'Kitchen Admin',
      role: row.role || 'admin',
      household_id: row.household_id || null,
      household_ids: hhIds
    };
  }

  // Database Access Methods
  public async fetchHouseholds(): Promise<Household[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('households')
      .select('*')
      .order('name');
    if (error) {
      console.warn('Could not fetch households (table may not exist yet):', error.message);
      return [];
    }
    return data || [];
  }

  public async createHousehold(household: Partial<Household>): Promise<Household> {
    if (!this.client) throw new Error('Supabase client not active');
    const { data, error } = await this.client
      .from('households')
      .insert(household)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  public async updateHousehold(id: string, updates: Partial<Household>): Promise<Household> {
    if (!this.client) throw new Error('Supabase client not active');
    const { data, error } = await this.client
      .from('households')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  public async deleteHousehold(id: string): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client
      .from('households')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  // Household Members & Invitations
  public async fetchHouseholdMembers(householdId: string): Promise<HouseholdMember[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('household_members')
      .select(`
        id,
        household_id,
        user_id,
        role_in_household,
        created_at,
        app_users (
          username,
          full_name,
          email
        )
      `)
      .eq('household_id', householdId);

    if (error) {
      console.warn('Could not fetch household members:', error.message);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      household_id: row.household_id,
      user_id: row.user_id,
      role_in_household: row.role_in_household || 'member',
      created_at: row.created_at,
      username: row.app_users?.username || 'member',
      fullName: row.app_users?.full_name || row.app_users?.username || 'Member',
      email: row.app_users?.email
    }));
  }

  public async fetchHouseholdInvitations(householdId: string): Promise<HouseholdInvitation[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('household_invitations')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Could not fetch household invitations:', error.message);
      return [];
    }
    return data || [];
  }

  public async createHouseholdInvitation(
    householdId: string,
    invitedBy: string,
    role: string = 'member',
    email?: string,
    validDays: number = 7
  ): Promise<HouseholdInvitation> {
    if (!this.client) throw new Error('Supabase client not active');
    const { data, error } = await this.client.rpc('create_household_invitation', {
      p_household_id: householdId,
      p_invited_by: invitedBy,
      p_role: role,
      p_email: email || null,
      p_valid_days: validDays
    });

    if (error) throw error;
    const row = data[0];
    return {
      id: row.id,
      household_id: row.household_id,
      invite_code: row.invite_code,
      role_in_household: row.role_in_household || role,
      status: row.status || 'pending',
      expires_at: row.expires_at,
      created_at: row.created_at,
      email
    };
  }

  public async acceptHouseholdInvitation(
    inviteCode: string,
    userId: string
  ): Promise<{ success: boolean; message: string; household_id?: string; household_name?: string; role_in_household?: string }> {
    if (!this.client) throw new Error('Supabase client not active');
    const { data, error } = await this.client.rpc('accept_household_invitation', {
      p_invite_code: inviteCode.trim(),
      p_user_id: userId
    });

    if (error) throw error;
    return data[0];
  }

  public async revokeHouseholdInvitation(invitationId: string): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client
      .from('household_invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId);
    if (error) throw error;
  }

  public async removeHouseholdMember(householdId: string, userId: string): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client
      .from('household_members')
      .delete()
      .eq('household_id', householdId)
      .eq('user_id', userId);
    if (error) throw error;
  }

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
        household_id,
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

  public async fetchMealSchedule(startDate: string, endDate: string, householdId?: string | null): Promise<MealSchedule[]> {
    if (!this.client) return [];
    let query = this.client
      .from('meal_schedule')
      .select(`
        id,
        household_id,
        schedule_date,
        meal_type,
        dish_id,
        headcount,
        household:households(*),
        dish:dishes(
          id,
          name,
          cook_notes,
          household_id,
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

    if (householdId) {
      query = query.eq('household_id', householdId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as unknown as MealSchedule[]) || [];
  }

  // Mutations
  public async updateHeadcountRPC(household_id: string, date: string, meal: MealType, delta: number): Promise<number> {
    if (!this.client) throw new Error('Supabase client not active');
    // Try calling with household_id, with fallback to legacy RPC if needed
    try {
      const { data, error } = await this.client.rpc('update_meal_headcount', {
        p_household_id: household_id,
        p_date: date,
        p_meal: meal,
        p_delta: delta
      });
      if (error) throw error;
      return data as number;
    } catch (e: any) {
      // Fallback to legacy single-household RPC
      const { data, error } = await this.client.rpc('update_meal_headcount', {
        p_date: date,
        p_meal: meal,
        p_delta: delta
      });
      if (error) throw error;
      return data as number;
    }
  }

  public async upsertMealSchedule(
    schedule_date: string,
    meal_type: MealType,
    dish_id: string,
    headcount: number,
    household_id: string
  ): Promise<MealSchedule> {
    if (!this.client) throw new Error('Supabase client not active');
    const { data, error } = await this.client
      .from('meal_schedule')
      .upsert(
        { schedule_date, meal_type, dish_id, headcount, household_id },
        { onConflict: 'household_id,schedule_date,meal_type' }
      )
      .select(`
        id,
        household_id,
        schedule_date,
        meal_type,
        dish_id,
        headcount,
        household:households(*),
        dish:dishes(
          id,
          name,
          cook_notes,
          household_id,
          recipe_ingredients (
            ingredient_id,
            qty_per_person,
            ingredient:ingredients(*)
          )
        )
      `)
      .single();
    if (error) throw error;
    return data as unknown as MealSchedule;
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
