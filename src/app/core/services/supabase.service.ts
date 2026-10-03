import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Ingredient } from '../models/ingredient.model';
import { InventoryItem } from '../models/inventory.model';
import { Dish } from '../models/dish.model';
import { MealSchedule, MealType } from '../models/meal-schedule.model';
import { Household, HouseholdMember, HouseholdInvitation, HouseholdMemberRole } from '../models/household.model';
import { AppUser, UserHouseholdMembership } from '../models/user.model';

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
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
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

  public get clientInstance(): SupabaseClient | null {
    return this.client;
  }

  public async fetchAppUserById(userId: string): Promise<AppUser | null> {
    if (!this.client) return null;

    try {
      const { data: userRow, error } = await this.client
        .from('app_users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error || !userRow) {
        return null;
      }

      const { data: memberRows } = await this.client
        .from('household_members')
        .select('household_id, role_in_household')
        .eq('user_id', userId);

      const memberships: UserHouseholdMembership[] = (memberRows && memberRows.length > 0)
        ? memberRows.map((m: any) => ({
            household_id: m.household_id,
            role: (m.role_in_household || 'member') as HouseholdMemberRole
          }))
        : [];

      const memberHhIds: string[] = memberships.map(m => m.household_id);

      const combinedSet = new Set<string>(memberHhIds);
      if (userRow.household_id) {
        combinedSet.add(userRow.household_id);
      }
      const hhIds = Array.from(combinedSet);

      return {
        id: userRow.id,
        username: userRow.username,
        email: userRow.email || undefined,
        fullName: userRow.full_name || 'Kitchen User',
        role: userRow.role || 'household_member',
        household_id: userRow.household_id || (hhIds.length > 0 ? hhIds[0] : null),
        household_ids: hhIds,
        memberships,
        avatar_url: userRow.avatar_url || undefined,
        phone: userRow.phone || undefined,
        dietary_preferences: userRow.dietary_preferences || undefined,
        bio: userRow.bio || undefined,
        created_at: userRow.created_at || undefined
      };
    } catch (e) {
      console.warn('Error fetching app user by ID:', e);
      return null;
    }
  }

  public async updateAppUserProfile(
    userId: string,
    updates: Partial<AppUser>
  ): Promise<{ success: boolean; data?: AppUser; error?: string }> {
    if (!this.client) {
      return { success: false, error: 'Supabase client is not configured' };
    }

    try {
      const payload: Record<string, any> = {};
      if (updates.fullName !== undefined) payload['full_name'] = updates.fullName.trim();
      if (updates.username !== undefined) payload['username'] = updates.username.trim().toLowerCase();
      if (updates.email !== undefined) payload['email'] = updates.email ? updates.email.trim() : null;
      if (updates.avatar_url !== undefined) payload['avatar_url'] = updates.avatar_url;
      if (updates.phone !== undefined) payload['phone'] = updates.phone ? updates.phone.trim() : null;
      if (updates.dietary_preferences !== undefined) payload['dietary_preferences'] = updates.dietary_preferences;
      if (updates.bio !== undefined) payload['bio'] = updates.bio;
      if (updates.household_id !== undefined) payload['household_id'] = updates.household_id;

      let { data, error } = await this.client
        .from('app_users')
        .update(payload)
        .eq('id', userId)
        .select()
        .maybeSingle();

      // Fallback: If newer optional columns don't exist yet, retry updating core fields
      if (error && (error.message.includes('column') || error.message.includes('schema'))) {
        const fallbackPayload: Record<string, any> = {};
        if (updates.fullName !== undefined) fallbackPayload['full_name'] = updates.fullName.trim();
        if (updates.username !== undefined) fallbackPayload['username'] = updates.username.trim().toLowerCase();
        if (updates.email !== undefined) fallbackPayload['email'] = updates.email ? updates.email.trim() : null;
        if (updates.avatar_url !== undefined) fallbackPayload['avatar_url'] = updates.avatar_url;
        if (updates.household_id !== undefined) fallbackPayload['household_id'] = updates.household_id;

        const retryRes = await this.client
          .from('app_users')
          .update(fallbackPayload)
          .eq('id', userId)
          .select()
          .maybeSingle();

        error = retryRes.error;
        data = retryRes.data;
      }

      if (error) {
        return { success: false, error: error.message };
      }

      // Sync Supabase Auth metadata if active session
      try {
        await this.client.auth.updateUser({
          data: {
            full_name: updates.fullName,
            name: updates.fullName,
            avatar_url: updates.avatar_url
          }
        });
      } catch (authErr) {
        // Non-fatal for standalone app_users
      }

      const refreshed = await this.fetchAppUserById(userId);
      return { success: true, data: refreshed || undefined };
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to update user profile' };
    }
  }

  public async updateAppUserPassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.client) {
      return { success: false, error: 'Supabase client is not configured' };
    }

    try {
      let authUpdated = false;
      try {
        const { error: authErr } = await this.client.auth.updateUser({
          password: newPassword
        });
        if (!authErr) {
          authUpdated = true;
        }
      } catch (e) {
        // Not a supabase auth user session
      }

      const { data: rpcSuccess, error: rpcErr } = await this.client.rpc('update_app_user_password', {
        p_user_id: userId,
        p_current_password: currentPassword,
        p_new_password: newPassword
      });

      if (rpcErr) {
        if (authUpdated) {
          return { success: true };
        }
        return { success: false, error: rpcErr.message };
      }

      if (rpcSuccess === false) {
        return { success: false, error: 'Current password does not match' };
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to update password' };
    }
  }

  public async ensureOAuthAppUser(authUser: {
    id: string;
    email?: string;
    user_metadata?: any;
  }): Promise<AppUser | null> {
    if (!this.client) return null;

    // Check if user already exists in app_users
    const existing = await this.fetchAppUserById(authUser.id);
    if (existing) {
      return existing;
    }

    const emailName = authUser.email ? authUser.email.split('@')[0] : 'user';
    const fullName =
      authUser.user_metadata?.['full_name'] ||
      authUser.user_metadata?.['name'] ||
      emailName;
    const avatarUrl =
      authUser.user_metadata?.['avatar_url'] ||
      authUser.user_metadata?.['picture'] ||
      null;
    const baseUsername = (authUser.user_metadata?.['user_name'] || emailName)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '');
    const username = `${baseUsername || 'user'}_${authUser.id.slice(0, 4)}`;

    try {
      const { data, error } = await this.client
        .from('app_users')
        .upsert(
          {
            id: authUser.id,
            username: username,
            email: authUser.email || null,
            password_hash: 'oauth_managed',
            full_name: fullName,
            role: 'household_member',
            household_id: null,
            avatar_url: avatarUrl
          },
          { onConflict: 'id' }
        )
        .select()
        .single();

      if (error) {
        console.warn('Fallback app_users upsert warning:', error.message);
      }

      const refreshed = await this.fetchAppUserById(authUser.id);
      if (refreshed) return refreshed;

      return {
        id: authUser.id,
        username: username,
        email: authUser.email,
        fullName: fullName,
        role: 'household_member',
        household_id: null,
        household_ids: [],
        memberships: [],
        avatar_url: avatarUrl || undefined
      };
    } catch (e) {
      console.warn('Fallback creation of OAuth app user failed:', e);
      return null;
    }
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
    const fullUser = await this.fetchAppUserById(row.id);
    if (fullUser) {
      return fullUser;
    }

    const hhIds: string[] = Array.isArray(row.household_ids)
      ? row.household_ids
      : (row.household_id ? [row.household_id] : []);

    const memberships: UserHouseholdMembership[] = hhIds.map(hid => ({
      household_id: hid,
      role: (row.role === 'owner' ? 'owner' : 'member') as HouseholdMemberRole
    }));

    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name || 'Kitchen Admin',
      role: row.role || 'admin',
      household_id: row.household_id || null,
      household_ids: hhIds,
      memberships
    };
  }

  // Database Access Methods
  public async fetchHouseholds(userId?: string): Promise<Household[]> {
    if (!this.client) return [];

    // 1. Try get_authorized_households RPC first (SECURITY DEFINER)
    try {
      const { data: rpcData, error: rpcError } = await this.client.rpc('get_authorized_households', {
        p_user_id: userId || null
      });

      if (!rpcError && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
        return rpcData as Household[];
      }
    } catch (e) {
      // Fallback to direct select
    }

    // 2. Direct table select fallback
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

  public async createHousehold(household: Partial<Household>, userId?: string): Promise<Household> {
    if (!this.client) throw new Error('Supabase client not active');

    // 1. Try calling the create_household stored procedure (SECURITY DEFINER)
    try {
      const { data: rpcData, error: rpcError } = await this.client.rpc('create_household', {
        p_name: household.name || 'New Household',
        p_code: household.code || null,
        p_contact_name: household.contact_name || null,
        p_contact_phone: household.contact_phone || null,
        p_address: household.address || null,
        p_default_headcount: Number(household.default_headcount) || 2,
        p_dietary_notes: household.dietary_notes || null,
        p_color_tag: household.color_tag || '#6366f1',
        p_user_id: userId || null
      });

      if (!rpcError && rpcData) {
        const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        if (result && result.id) {
          return result as Household;
        }
      }
      if (rpcError) {
        console.warn('create_household RPC call returned error, falling back to direct insert:', rpcError.message);
      }
    } catch (rpcErr) {
      console.warn('create_household RPC threw exception, falling back to direct insert:', rpcErr);
    }

    // 2. Direct table insert fallback
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

  public async deleteHousehold(id: string, userId?: string): Promise<void> {
    if (!this.client) return;

    // 1. Try calling delete_household stored procedure (SECURITY DEFINER)
    try {
      const { data: rpcData, error: rpcError } = await this.client.rpc('delete_household', {
        p_household_id: id,
        p_user_id: userId || null
      });

      if (!rpcError && rpcData === true) {
        return;
      }
    } catch (rpcErr) {
      console.warn('delete_household RPC call failed, falling back to direct delete:', rpcErr);
    }

    // 2. Direct delete fallback
    const { error } = await this.client
      .from('households')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  // Household Members & Invitations
  public async fetchHouseholdMembers(householdId: string): Promise<HouseholdMember[]> {
    if (!this.client) return [];

    // 1. Try get_household_members RPC first (SECURITY DEFINER)
    try {
      const { data: rpcData, error: rpcError } = await this.client.rpc('get_household_members', {
        p_household_id: householdId
      });

      if (!rpcError && rpcData && Array.isArray(rpcData)) {
        return rpcData.map((row: any) => ({
          id: row.id,
          household_id: row.household_id,
          user_id: row.user_id,
          role_in_household: row.role_in_household || 'member',
          created_at: row.created_at,
          username: row.username || 'member',
          fullName: row.full_name || row.username || 'Member',
          email: row.email
        }));
      }
    } catch (e) {
      // Fallback to direct table query
    }

    // 2. Direct table query fallback
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
