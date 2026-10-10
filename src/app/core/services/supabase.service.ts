import { Injectable, inject, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { LumberjackService } from '@ngworker/lumberjack';
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
  private lumberjack = inject(LumberjackService);
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
        this.lumberjack.logInfo('Initializing Supabase client', { url: current.url }, 'SupabaseService');
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
        this.lumberjack.logError('Failed to initialize Supabase client', { error: err?.message || String(err) }, 'SupabaseService');
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
        this.lumberjack.logWarning(`Supabase connection test failed: ${error.message}`, undefined, 'SupabaseService');
        return { success: false, error: error.message };
      }
      this.isConnected.set(true);
      this.connectionError.set(null);
      this.lumberjack.logInfo('Supabase database connection established successfully', undefined, 'SupabaseService');
      return { success: true };
    } catch (err: any) {
      this.isConnected.set(false);
      this.connectionError.set(err.message || 'Unknown network error');
      this.lumberjack.logError('Supabase connection test threw exception', { error: err?.message || String(err) }, 'SupabaseService');
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
        if (error) {
          this.lumberjack.logWarning(`Failed to fetch app user ${userId}: ${error.message}`, { userId }, 'SupabaseService');
        }
        return null;
      }

      // Fetch memberships: try get_user_memberships RPC (SECURITY DEFINER) first, then fallback to direct query
      let memberRows: any[] | null = null;
      try {
        const { data: rpcMembers, error: rpcErr } = await this.client.rpc('get_user_memberships', {
          p_user_id: userId
        });
        if (!rpcErr && rpcMembers && Array.isArray(rpcMembers)) {
          memberRows = rpcMembers;
        }
      } catch (e) {
        // Fallback to direct query
      }

      if (!memberRows) {
        const { data } = await this.client
          .from('household_members')
          .select('household_id, role_in_household')
          .eq('user_id', userId);
        memberRows = data;
      }

      const memberships: UserHouseholdMembership[] = (memberRows && memberRows.length > 0)
        ? memberRows.map((m: any) => ({
            household_id: m.household_id,
            role: (m.role_in_household || 'member') as HouseholdMemberRole
          }))
        : [];

      // If user has rows in household_members, those are their authoritative memberships.
      // If household_members is empty but userRow.household_id is set (legacy fallback), migrate into memberships.
      if (memberships.length === 0 && userRow.household_id) {
        memberships.push({
          household_id: userRow.household_id,
          role: (userRow.role === 'owner' ? 'owner' : 'member') as HouseholdMemberRole
        });
      }

      const memberHhIds = memberships.map(m => m.household_id);
      const activePrimaryHhId = (userRow.household_id && memberHhIds.includes(userRow.household_id))
        ? userRow.household_id
        : (memberHhIds.length > 0 ? memberHhIds[0] : null);

      return {
        id: userRow.id,
        username: userRow.username,
        email: userRow.email || undefined,
        fullName: userRow.full_name || 'Kitchen User',
        role: userRow.role || 'household_member',
        household_id: activePrimaryHhId,
        household_ids: memberHhIds,
        memberships,
        avatar_url: userRow.avatar_url || undefined,
        phone: userRow.phone || undefined,
        dietary_preferences: userRow.dietary_preferences || undefined,
        bio: userRow.bio || undefined,
        created_at: userRow.created_at || undefined
      };
    } catch (e) {
      this.lumberjack.logWarning('Error fetching app user by ID', { error: (e as any)?.message || String(e), userId }, 'SupabaseService');
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
      this.lumberjack.logInfo('Updating app user profile', { userId, fields: Object.keys(updates) }, 'SupabaseService');
      const corePayload: Record<string, any> = {};
      if (updates.fullName !== undefined) corePayload['full_name'] = updates.fullName.trim();
      if (updates.username !== undefined) corePayload['username'] = updates.username.trim().toLowerCase();
      if (updates.email !== undefined) corePayload['email'] = updates.email ? updates.email.trim() : null;
      if (updates.avatar_url !== undefined) corePayload['avatar_url'] = updates.avatar_url;
      if (updates.household_id !== undefined) corePayload['household_id'] = updates.household_id;

      const payload: Record<string, any> = { ...corePayload };
      if (updates.phone !== undefined) payload['phone'] = updates.phone ? updates.phone.trim() : null;
      if (updates.dietary_preferences !== undefined) payload['dietary_preferences'] = updates.dietary_preferences;
      if (updates.bio !== undefined) payload['bio'] = updates.bio;

      let { error } = await this.client
        .from('app_users')
        .update(payload)
        .eq('id', userId)
        .select()
        .maybeSingle();

      // Fallback: If newer optional columns don't exist yet, retry updating core fields
      if (error && (error.message.includes('column') || error.message.includes('schema'))) {
        const retryRes = await this.client
          .from('app_users')
          .update(corePayload)
          .eq('id', userId)
          .select()
          .maybeSingle();

        error = retryRes.error;
      }

      if (error) {
        this.lumberjack.logWarning(`Error updating app user profile for ${userId}: ${error.message}`, { userId }, 'SupabaseService');
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
      } catch {
        // Non-fatal for standalone app_users
      }

      const refreshed = await this.fetchAppUserById(userId);
      this.lumberjack.logInfo('User profile updated successfully', { userId }, 'SupabaseService');
      return { success: true, data: refreshed || undefined };
    } catch (e: any) {
      this.lumberjack.logError('Failed to update user profile', { error: e?.message || String(e), userId }, 'SupabaseService');
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
      this.lumberjack.logInfo('Updating user password via RPC', { userId }, 'SupabaseService');
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
          this.lumberjack.logInfo('Auth session password updated successfully', undefined, 'SupabaseService');
          return { success: true };
        }
        this.lumberjack.logWarning(`RPC password update failed: ${rpcErr.message}`, undefined, 'SupabaseService');
        return { success: false, error: rpcErr.message };
      }

      if (rpcSuccess === false) {
        this.lumberjack.logWarning('Password update rejected: Current password mismatch', undefined, 'SupabaseService');
        return { success: false, error: 'Current password does not match' };
      }

      this.lumberjack.logInfo('Password updated successfully for user', { userId }, 'SupabaseService');
      return { success: true };
    } catch (e: any) {
      this.lumberjack.logError('Exception during password update', { error: e?.message || String(e), userId }, 'SupabaseService');
      return { success: false, error: e.message || 'Failed to update password' };
    }
  }

  public async ensureOAuthAppUser(authUser: {
    id: string;
    email?: string;
    user_metadata?: any;
  }): Promise<AppUser | null> {
    if (!this.client) return null;

    this.lumberjack.logInfo('Ensuring OAuth app user record exists', { id: authUser.id, email: authUser.email }, 'SupabaseService');
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
        this.lumberjack.logWarning(`Fallback app_users upsert warning: ${error.message}`, undefined, 'SupabaseService');
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
      this.lumberjack.logWarning('Fallback creation of OAuth app user failed', { error: (e as any)?.message || String(e) }, 'SupabaseService');
      return null;
    }
  }

  // Authentication Verification
  public async verifyUserCredentials(username: string, password: string): Promise<AppUser | null> {
    if (!this.client) {
      throw new Error('Supabase client is not configured. Please check environment variables.');
    }

    this.lumberjack.logInfo('Verifying app user credentials via RPC', { username }, 'SupabaseService');
    const { data, error } = await this.client.rpc('verify_app_user', {
      p_username: username.trim(),
      p_password: password
    });

    if (error) {
      this.lumberjack.logError('Credential verification error', { error: error?.message || String(error), username }, 'SupabaseService');
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      this.lumberjack.logWarning('User credentials invalid or not found', { username }, 'SupabaseService');
      return null;
    }

    const row = data[0];
    const fullUser = await this.fetchAppUserById(row.id);
    if (fullUser) {
      this.lumberjack.logInfo('User credentials verified with full profile', { username, userId: fullUser.id }, 'SupabaseService');
      return fullUser;
    }

    const hhIds: string[] = Array.isArray(row.household_ids)
      ? row.household_ids
      : (row.household_id ? [row.household_id] : []);

    const memberships: UserHouseholdMembership[] = hhIds.map(hid => ({
      household_id: hid,
      role: (row.role === 'owner' ? 'owner' : 'member') as HouseholdMemberRole
    }));

    this.lumberjack.logInfo('User credentials verified successfully', { username, userId: row.id }, 'SupabaseService');
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

      if (!rpcError && rpcData && Array.isArray(rpcData)) {
        return rpcData as Household[];
      }
      if (rpcError) {
        this.lumberjack.logWarning(`get_authorized_households RPC error, falling back to direct select: ${rpcError.message}`, undefined, 'SupabaseService');
      }
    } catch (e: any) {
      this.lumberjack.logWarning('get_authorized_households RPC exception, falling back to direct select', { error: e?.message || String(e) }, 'SupabaseService');
    }

    // 2. Direct table select fallback
    const { data, error } = await this.client
      .from('households')
      .select('*')
      .order('name');
    if (error) {
      this.lumberjack.logWarning(`Could not fetch households: ${error.message}`, undefined, 'SupabaseService');
      return [];
    }
    return data || [];
  }

  public async createHousehold(household: Partial<Household>, userId?: string): Promise<Household> {
    if (!this.client) throw new Error('Supabase client not active');

    this.lumberjack.logInfo('Creating household in Supabase', { name: household.name, code: household.code, userId }, 'SupabaseService');
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
          this.lumberjack.logInfo('Household created successfully via RPC', { id: result.id, name: result.name }, 'SupabaseService');
          return result as Household;
        }
      }
      if (rpcError) {
        this.lumberjack.logWarning(`create_household RPC error, falling back to direct insert: ${rpcError.message}`, undefined, 'SupabaseService');
      }
    } catch (rpcErr: any) {
      this.lumberjack.logWarning('create_household RPC exception, falling back to direct insert', { error: rpcErr?.message || String(rpcErr) }, 'SupabaseService');
    }

    // 2. Direct table insert fallback
    const { data, error } = await this.client
      .from('households')
      .insert(household)
      .select()
      .single();
    if (error) {
      this.lumberjack.logError('Failed to insert household record', { error: error?.message || String(error) }, 'SupabaseService');
      throw error;
    }

    if (userId) {
      try {
        await this.client.from('household_members').upsert(
          { household_id: data.id, user_id: userId, role_in_household: 'owner' },
          { onConflict: 'household_id,user_id' }
        );
      } catch {
        // Non-fatal fallback
      }
    }

    this.lumberjack.logInfo('Household created successfully via direct insert', { id: data.id, name: data.name }, 'SupabaseService');
    return data;
  }

  public async updateHousehold(id: string, updates: Partial<Household>): Promise<Household> {
    if (!this.client) throw new Error('Supabase client not active');
    this.lumberjack.logInfo('Updating household in Supabase', { id, fields: Object.keys(updates) }, 'SupabaseService');
    const { data, error } = await this.client
      .from('households')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      this.lumberjack.logError('Failed to update household in Supabase', { error: error?.message || String(error), id }, 'SupabaseService');
      throw error;
    }
    return data;
  }

  public async deleteHousehold(id: string, userId?: string): Promise<void> {
    if (!this.client) return;

    this.lumberjack.logInfo('Deleting household from Supabase', { id, userId }, 'SupabaseService');
    // 1. Try calling delete_household stored procedure (SECURITY DEFINER)
    try {
      const { data: rpcData, error: rpcError } = await this.client.rpc('delete_household', {
        p_household_id: id,
        p_user_id: userId || null
      });

      if (!rpcError && rpcData === true) {
        this.lumberjack.logInfo('Household deleted via RPC', { id }, 'SupabaseService');
        return;
      }
    } catch (rpcErr: any) {
      this.lumberjack.logWarning('delete_household RPC call failed, falling back to direct delete', { error: rpcErr?.message || String(rpcErr) }, 'SupabaseService');
    }

    // 2. Direct delete fallback
    const { error } = await this.client
      .from('households')
      .delete()
      .eq('id', id);
    if (error) {
      this.lumberjack.logError('Failed to delete household', { error: error?.message || String(error), id }, 'SupabaseService');
      throw error;
    }
    this.lumberjack.logInfo('Household deleted via direct delete', { id }, 'SupabaseService');
  }

  // Household Members & Invitations
  public async fetchHouseholdMembers(householdId: string): Promise<HouseholdMember[]> {
    if (!this.client) return [];

    const memberMap = new Map<string, HouseholdMember>();
    const addMember = (row: any, userInfo?: any) => {
      const userId = row.user_id || row.id;
      if (!userId || memberMap.has(userId)) return;
      const username = userInfo?.username || row.username || 'member';
      memberMap.set(userId, {
        id: row.id,
        household_id: row.household_id || householdId,
        user_id: userId,
        role_in_household: (row.role_in_household || 'owner') as HouseholdMemberRole,
        created_at: row.created_at,
        username,
        fullName: userInfo?.full_name || row.full_name || username || 'Member',
        email: userInfo?.email || row.email
      });
    };

    // 1. Primary: get_household_members RPC (SECURITY DEFINER)
    try {
      const { data: rpcData, error: rpcError } = await this.client.rpc('get_household_members', {
        p_household_id: householdId
      });

      if (!rpcError && Array.isArray(rpcData)) {
        rpcData.forEach(row => addMember(row));
      } else if (rpcError) {
        this.lumberjack.logWarning(`get_household_members RPC error, falling back: ${rpcError.message}`, undefined, 'SupabaseService');
      }
    } catch (e: any) {
      this.lumberjack.logWarning('get_household_members RPC exception, falling back', { error: e?.message || String(e) }, 'SupabaseService');
    }

    // 2. Fallback: Direct household_members table query if RPC returned nothing
    if (memberMap.size === 0) {
      try {
        const { data, error } = await this.client
          .from('household_members')
          .select('id, household_id, user_id, role_in_household, created_at, app_users(username, full_name, email)')
          .eq('household_id', householdId);

        if (!error && Array.isArray(data)) {
          for (const row of data as any[]) {
            const userObj = Array.isArray(row.app_users) ? row.app_users[0] : row.app_users;
            addMember(row, userObj);
          }
        }
      } catch {
        // Non-fatal fallback
      }
    }

    // 3. Ensure any users linked via app_users.household_id are included
    try {
      const { data: appUsersData, error: appUsersErr } = await this.client
        .from('app_users')
        .select('id, username, full_name, email, role, created_at')
        .eq('household_id', householdId);

      if (!appUsersErr && Array.isArray(appUsersData)) {
        for (const u of appUsersData) {
          addMember({
            id: `app-user-${u.id}`,
            household_id: householdId,
            user_id: u.id,
            role_in_household: u.role === 'owner' ? 'owner' : 'member',
            created_at: u.created_at,
            username: u.username,
            full_name: u.full_name,
            email: u.email
          });
        }
      }
    } catch {
      // Non-fatal
    }

    return Array.from(memberMap.values());
  }

  public async fetchHouseholdInvitations(householdId: string): Promise<HouseholdInvitation[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('household_invitations')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false });

    if (error) {
      this.lumberjack.logWarning(`Could not fetch household invitations: ${error.message}`, undefined, 'SupabaseService');
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
    this.lumberjack.logInfo('Creating household invitation via RPC', { householdId, invitedBy, role, email, validDays }, 'SupabaseService');
    const { data, error } = await this.client.rpc('create_household_invitation', {
      p_household_id: householdId,
      p_invited_by: invitedBy,
      p_role: role,
      p_email: email || null,
      p_valid_days: validDays
    });

    if (error) {
      this.lumberjack.logError('Failed to create household invitation', { error: error?.message || String(error), householdId }, 'SupabaseService');
      throw error;
    }
    const row = data[0];
    this.lumberjack.logInfo('Created household invitation successfully', { inviteCode: row.invite_code, householdId }, 'SupabaseService');
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
    this.lumberjack.logInfo('Accepting household invitation via RPC', { inviteCode, userId }, 'SupabaseService');
    const { data, error } = await this.client.rpc('accept_household_invitation', {
      p_invite_code: inviteCode.trim(),
      p_user_id: userId
    });

    if (error) {
      this.lumberjack.logError('Failed to accept household invitation', { error: error?.message || String(error), inviteCode }, 'SupabaseService');
      throw error;
    }
    const result = data[0];
    this.lumberjack.logInfo('Processed invitation acceptance', { success: result.success, message: result.message }, 'SupabaseService');
    return result;
  }

  public async revokeHouseholdInvitation(invitationId: string): Promise<void> {
    if (!this.client) return;
    this.lumberjack.logInfo('Revoking household invitation', { invitationId }, 'SupabaseService');
    const { error } = await this.client
      .from('household_invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId);
    if (error) {
      this.lumberjack.logError('Failed to revoke household invitation', { error: error?.message || String(error), invitationId }, 'SupabaseService');
      throw error;
    }
  }

  public async removeHouseholdMember(householdId: string, userId: string): Promise<void> {
    if (!this.client) return;
    this.lumberjack.logInfo('Removing household member', { householdId, userId }, 'SupabaseService');
    const { error } = await this.client
      .from('household_members')
      .delete()
      .eq('household_id', householdId)
      .eq('user_id', userId);
    if (error) {
      this.lumberjack.logError('Failed to remove household member', { error: error?.message || String(error), householdId, userId }, 'SupabaseService');
      throw error;
    }

    // Also null out app_users.household_id if it matched the removed household
    try {
      await this.client
        .from('app_users')
        .update({ household_id: null })
        .eq('id', userId)
        .eq('household_id', householdId);
    } catch (e: any) {
      this.lumberjack.logWarning('Could not clear app_users.household_id after member removal', { error: e?.message || String(e) }, 'SupabaseService');
    }
  }

  public async fetchIngredients(): Promise<Ingredient[]> {
    if (!this.client) return [];
    const { data, error } = await this.client.from('ingredients').select('*').order('name');
    if (error) {
      this.lumberjack.logError('Failed to fetch ingredients', { error: error?.message || String(error) }, 'SupabaseService');
      throw error;
    }
    return data || [];
  }

  public async fetchInventory(): Promise<InventoryItem[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('inventory')
      .select('*, ingredient:ingredients(*)')
      .order('updated_at', { ascending: false });
    if (error) {
      this.lumberjack.logError('Failed to fetch inventory', { error: error?.message || String(error) }, 'SupabaseService');
      throw error;
    }
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
    if (error) {
      this.lumberjack.logError('Failed to fetch dishes', { error: error?.message || String(error) }, 'SupabaseService');
      throw error;
    }
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
    if (error) {
      this.lumberjack.logError('Failed to fetch meal schedule', { error: error?.message || String(error), startDate, endDate }, 'SupabaseService');
      throw error;
    }
    return (data as unknown as MealSchedule[]) || [];
  }

  // Mutations
  public async updateHeadcountRPC(household_id: string, date: string, meal: MealType, delta: number): Promise<number> {
    if (!this.client) throw new Error('Supabase client not active');
    this.lumberjack.logInfo('Updating meal headcount via RPC', { household_id, date, meal, delta }, 'SupabaseService');
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
      const { data, error } = await this.client.rpc('update_meal_headcount', {
        p_date: date,
        p_meal: meal,
        p_delta: delta
      });
      if (error) {
        this.lumberjack.logError('Failed to update meal headcount via RPC', { error: error?.message || String(error), household_id, date, meal }, 'SupabaseService');
        throw error;
      }
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
    this.lumberjack.logInfo('Upserting meal schedule', { schedule_date, meal_type, dish_id, headcount, household_id }, 'SupabaseService');
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
    if (error) {
      this.lumberjack.logError('Failed to upsert meal schedule', { error: error?.message || String(error), schedule_date, meal_type, dish_id }, 'SupabaseService');
      throw error;
    }
    return data as unknown as MealSchedule;
  }

  public async updateInventory(ingredient_id: string, quantity: number, min_threshold?: number): Promise<void> {
    if (!this.client) throw new Error('Supabase client not active');
    this.lumberjack.logInfo('Updating inventory in Supabase', { ingredient_id, quantity, min_threshold }, 'SupabaseService');
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
    if (error) {
      this.lumberjack.logError('Failed to update inventory', { error: error?.message || String(error), ingredient_id }, 'SupabaseService');
      throw error;
    }
  }

  public async createIngredient(ingredient: Omit<Ingredient, 'id'>, initialStock: number = 0, minThreshold: number = 0): Promise<Ingredient> {
    if (!this.client) throw new Error('Supabase client not active');
    this.lumberjack.logInfo('Creating ingredient in Supabase', { name: ingredient.name, category: ingredient.category }, 'SupabaseService');
    const { data: ingData, error: ingError } = await this.client
      .from('ingredients')
      .insert(ingredient)
      .select()
      .single();
    if (ingError) {
      this.lumberjack.logError('Failed to insert ingredient', { error: ingError?.message || String(ingError), name: ingredient.name }, 'SupabaseService');
      throw ingError;
    }

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
    this.lumberjack.logInfo('Creating dish in Supabase', { name: dish.name, ingredientsCount: ingredients.length }, 'SupabaseService');
    const { data: dishData, error: dishError } = await this.client
      .from('dishes')
      .insert(dish)
      .select()
      .single();
    if (dishError) {
      this.lumberjack.logError('Failed to insert dish', { error: dishError?.message || String(dishError), name: dish.name }, 'SupabaseService');
      throw dishError;
    }

    if (ingredients.length > 0) {
      const rows = ingredients.map(ing => ({
        dish_id: dishData.id,
        ingredient_id: ing.ingredient_id,
        qty_per_person: ing.qty_per_person
      }));
      const { error: ingError } = await this.client.from('recipe_ingredients').insert(rows);
      if (ingError) {
        this.lumberjack.logError('Failed to insert recipe ingredients', { error: ingError?.message || String(ingError), dishId: dishData.id }, 'SupabaseService');
        throw ingError;
      }
    }
  }

  public async deleteDish(dishId: string): Promise<void> {
    if (!this.client) throw new Error('Supabase client not active');
    this.lumberjack.logInfo('Deleting dish from Supabase', { dishId }, 'SupabaseService');
    const { error } = await this.client.from('dishes').delete().eq('id', dishId);
    if (error) {
      this.lumberjack.logError('Failed to delete dish', { error: error?.message || String(error), dishId }, 'SupabaseService');
      throw error;
    }
  }
}
