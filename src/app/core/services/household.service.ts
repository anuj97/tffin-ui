import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { LumberjackService } from '@ngworker/lumberjack';
import { Household, HouseholdMember, HouseholdInvitation, HouseholdMemberRole } from '../models/household.model';
import { UserHouseholdMembership } from '../models/user.model';

export const DEFAULT_HOUSEHOLD: Household = {
  id: 'default-household-01',
  name: 'Main Household',
  code: 'HH-01',
  contact_name: 'Primary Contact',
  default_headcount: 3,
  dietary_notes: 'Standard diet',
  color_tag: '#6366f1',
  is_active: true
};

@Injectable({
  providedIn: 'root'
})
export class HouseholdService {
  private lumberjack = inject(LumberjackService);
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);
  private notifications = inject(NotificationService);

  // State Signals
  public households = signal<Household[]>([DEFAULT_HOUSEHOLD]);
  public householdMembers = signal<HouseholdMember[]>([]);
  public householdInvitations = signal<HouseholdInvitation[]>([]);
  public selectedHouseholdId = signal<string | null>(null); // null = "All Households"
  public isLoading = signal<boolean>(false);
  public lastError = signal<string | null>(null);

  constructor() {
    this.init();

    // Automatically re-sync households when authenticated user changes
    effect(() => {
      const user = this.auth.currentUser();
      if (this.supabase.hasClient && user) {
        untracked(() => {
          this.loadFromSupabase().catch(err => {
            this.lumberjack.logWarning('Failed to load households for user session', { error: err?.message || String(err) }, 'HouseholdService');
          });
        });
      }
    });
  }

  public async init(): Promise<void> {
    if (!this.supabase.hasClient) {
      this.lumberjack.logInfo('Supabase client is not configured; running with default household', undefined, 'HouseholdService');
      return;
    }

    this.isLoading.set(true);
    try {
      await this.loadFromSupabase();
    } catch (err: any) {
      this.lumberjack.logWarning('Failed to load households from Supabase', { error: err?.message || String(err) }, 'HouseholdService');
    } finally {
      this.isLoading.set(false);
    }
  }

  public clearState(): void {
    this.households.set([DEFAULT_HOUSEHOLD]);
    this.householdMembers.set([]);
    this.householdInvitations.set([]);
    this.selectedHouseholdId.set(null);
  }

  public async loadFromSupabase(): Promise<void> {
    try {
      this.lastError.set(null);
      const userId = this.auth.currentUser()?.id;
      const hhs = await this.supabase.fetchHouseholds(userId);

      if (hhs && hhs.length > 0) {
        this.households.set(hhs);
        this.lumberjack.logInfo(`Loaded ${hhs.length} households from Supabase`, undefined, 'HouseholdService');
      } else {
        const user = this.auth.currentUser();
        // If a regular user is signed in and has no households, do not inject DEFAULT_HOUSEHOLD
        if (user && !['admin', 'chef'].includes(user.role)) {
          this.households.set([]);
        } else {
          this.households.set([DEFAULT_HOUSEHOLD]);
        }
      }
    } catch (err: any) {
      this.lumberjack.logError('Failed to load households from Supabase', { error: err?.message || String(err) }, 'HouseholdService');
      this.lastError.set(err.message || 'Failed to load households from Supabase');
      throw err;
    }
  }

  // Lookups & Computeds
  // Authorized households that the current signed-in user is a part of
  public authorizedHouseholds = computed<Household[]>(() => {
    const user = this.auth.currentUser();
    const all = this.households().filter(h => h.is_active);

    if (!user) return all.length > 0 ? all : [DEFAULT_HOUSEHOLD];

    // Unrestricted admin / kitchen staff can view all active households
    if (user.role === 'admin' || user.role === 'chef') {
      return all.length > 0 ? all : [DEFAULT_HOUSEHOLD];
    }

    // Collect all permitted household IDs from:
    // 1. user.memberships array
    // 2. user.household_ids array
    // 3. user.household_id string
    // 4. householdMembers signal where user_id matches
    const allowedIds = new Set<string>();
    if (user.memberships && user.memberships.length > 0) {
      user.memberships.forEach(m => allowedIds.add(m.household_id));
    }
    if (user.household_ids && user.household_ids.length > 0) {
      user.household_ids.forEach(id => allowedIds.add(id));
    }
    if (user.household_id) {
      allowedIds.add(user.household_id);
    }
    for (const m of this.householdMembers()) {
      if (m.user_id === user.id) {
        allowedIds.add(m.household_id);
      }
    }

    if (allowedIds.size > 0) {
      return all.filter(h => allowedIds.has(h.id));
    }

    // New/unassigned users belong to 0 households
    return [];
  });

  public authorizedHouseholdIds = computed(() => {
    return new Set(this.authorizedHouseholds().map(h => h.id));
  });

  public activeHouseholds = computed(() => {
    return this.authorizedHouseholds();
  });

  public effectiveHouseholdId = computed<string | null>(() => {
    const authList = this.authorizedHouseholds();
    if (authList.length === 1) {
      return authList[0].id;
    }
    const sel = this.selectedHouseholdId();
    if (sel && this.authorizedHouseholdIds().has(sel)) {
      return sel;
    }
    return null;
  });

  public isSingleHouseholdUser = computed(() => this.authorizedHouseholds().length === 1);

  public singleHousehold = computed(() => this.authorizedHouseholds()[0] || null);

  public householdsMap = computed(() => {
    const map = new Map<string, Household>();
    for (const h of this.households()) {
      map.set(h.id, h);
    }
    return map;
  });

  public selectedHousehold = computed(() => {
    const id = this.effectiveHouseholdId();
    if (!id) return null;
    return this.householdsMap().get(id) || null;
  });

  public userMemberships = computed<UserHouseholdMembership[]>(() => {
    const u = this.auth.currentUser();
    if (!u) return [];
    if (u.memberships && u.memberships.length > 0) {
      return u.memberships;
    }
    return this.householdMembers()
      .filter(m => m.user_id === u.id)
      .map(m => ({
        household_id: m.household_id,
        role: m.role_in_household
      }));
  });

  // Household Selection
  public setSelectedHousehold(id: string | null): void {
    this.selectedHouseholdId.set(id);
  }

  // Role and Permission Resolution
  public getRoleInHousehold(householdId: string): HouseholdMemberRole | null {
    const user = this.auth.currentUser();
    if (!user) return null;

    // Kitchen admin has superuser permissions
    if (user.role === 'admin') return 'owner';
    // Chef can plan meals for any household
    if (user.role === 'chef') return 'member';

    // 1. Check user memberships loaded on AppUser
    const userMem = user.memberships?.find(m => m.household_id === householdId);
    if (userMem) return userMem.role;

    // 2. Check loaded householdMembers roster
    const rosterMem = this.householdMembers().find(
      m => m.household_id === householdId && m.user_id === user.id
    );
    if (rosterMem) return rosterMem.role_in_household;

    // 3. Fallback only for legacy users without memberships array
    if (!user.memberships || user.memberships.length === 0) {
      if (user.role === 'owner' && (user.household_id === householdId || user.household_ids?.includes(householdId))) {
        return 'owner';
      }
      if (user.household_id === householdId || user.household_ids?.includes(householdId)) {
        return 'member';
      }
    }

    return null;
  }

  public isOwner(householdId: string): boolean {
    const user = this.auth.currentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    return this.getRoleInHousehold(householdId) === 'owner';
  }

  public canManage(householdId: string): boolean {
    return this.isOwner(householdId);
  }

  public canPlanMeals(householdId: string): boolean {
    const user = this.auth.currentUser();
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'chef') return true;
    const role = this.getRoleInHousehold(householdId);
    return role === 'owner' || role === 'member';
  }

  public isViewer(householdId: string): boolean {
    const user = this.auth.currentUser();
    if (!user || user.role === 'admin' || user.role === 'chef') return false;
    return this.getRoleInHousehold(householdId) === 'viewer';
  }

  public canManageAnyHousehold = computed<boolean>(() => {
    const user = this.auth.currentUser();
    if (!user) return false;
    if (['admin', 'chef'].includes(user.role)) return true;
    const authed = this.authorizedHouseholds();
    if (authed.length === 0) return true; // Unassigned user can create one
    return authed.some(h => this.isOwner(h.id));
  });

  public ownedHouseholdIds = computed<Set<string>>(() => {
    const set = new Set<string>();
    for (const h of this.authorizedHouseholds()) {
      if (this.isOwner(h.id)) {
        set.add(h.id);
      }
    }
    return set;
  });

  // Household CRUD Actions
  public async createHousehold(household: Partial<Household>): Promise<Household | null> {
    const user = this.auth.currentUser();
    const role = user?.role;
    const isUnassignedUser = this.authorizedHouseholds().length === 0 || (!user?.household_ids || user.household_ids.length === 0);

    this.lumberjack.logInfo('Initiating household creation', { name: household.name, code: household.code, userId: user?.id }, 'HouseholdService');
    if (role && !['admin', 'owner'].includes(role) && !isUnassignedUser) {
      this.lumberjack.logWarning('Household creation rejected: User unauthorized', { role, userId: user?.id }, 'HouseholdService');
      this.notifications.show('Only kitchen administrators or unassigned members can create households.', 'error');
      return null;
    }

    if (!this.supabase.hasClient) {
      const newHh: Household = {
        id: 'hh-' + Date.now(),
        name: household.name || 'New Household',
        code: household.code || `HH-${this.households().length + 1}`,
        contact_name: household.contact_name || user?.fullName || '',
        contact_phone: household.contact_phone || '',
        address: household.address || '',
        default_headcount: household.default_headcount || 2,
        dietary_notes: household.dietary_notes || '',
        color_tag: household.color_tag || '#6366f1',
        is_active: household.is_active ?? true,
        created_at: new Date().toISOString()
      };
      this.households.set([...this.households(), newHh]);

      if (user) {
        const isStaff = ['admin', 'chef'].includes(user.role);
        if (!isStaff || isUnassignedUser) {
          const newMember: HouseholdMember = {
            id: 'hm-' + Date.now(),
            household_id: newHh.id,
            user_id: user.id,
            role_in_household: 'owner',
            username: user.username,
            fullName: user.fullName || user.username
          };
          this.householdMembers.update(members => [...members, newMember]);

          const currentIds = user.household_ids || [];
          const currentMems = user.memberships || [];
          const updatedUser = {
            ...user,
            household_id: newHh.id,
            household_ids: [...currentIds, newHh.id],
            memberships: [...currentMems, { household_id: newHh.id, role: 'owner' as HouseholdMemberRole }]
          };
          this.auth.currentUser.set(updatedUser);
          localStorage.setItem('tffin_auth_user', JSON.stringify(updatedUser));
        }
      }

      this.selectedHouseholdId.set(newHh.id);
      this.lumberjack.logInfo('Household created in local mode', { id: newHh.id, name: newHh.name }, 'HouseholdService');
      this.notifications.show(`Created household: ${newHh.name}! You are now the household owner.`, 'success');
      return newHh;
    }

    try {
      const created = await this.supabase.createHousehold(household, user?.id);
      this.households.set([...this.households(), created]);

      if (user) {
        const isStaff = ['admin', 'chef'].includes(user.role);
        if (!isStaff || isUnassignedUser) {
          try {
            await this.supabase.clientInstance?.from('household_members').upsert(
              {
                household_id: created.id,
                user_id: user.id,
                role_in_household: 'owner'
              },
              { onConflict: 'household_id,user_id' }
            );
          } catch (memErr: any) {
            this.lumberjack.logWarning('Could not insert household_member record', { error: memErr?.message || String(memErr) }, 'HouseholdService');
          }

          const currentIds = user.household_ids || [];
          const currentMems = user.memberships || [];
          const updatedUser = {
            ...user,
            household_id: created.id,
            household_ids: [...currentIds, created.id],
            memberships: [...currentMems, { household_id: created.id, role: 'owner' as HouseholdMemberRole }]
          };
          this.auth.currentUser.set(updatedUser);
          localStorage.setItem('tffin_auth_user', JSON.stringify(updatedUser));
        }
      }

      this.selectedHouseholdId.set(created.id);
      this.lumberjack.logInfo('Household created via Supabase backend', { id: created.id, name: created.name }, 'HouseholdService');
      this.notifications.show(`Created household: ${created.name}! You are now the household owner.`, 'success');
      return created;
    } catch (err: any) {
      this.lumberjack.logError('Failed to create household', { error: err?.message || String(err) }, 'HouseholdService');
      this.notifications.show(`Failed to create household: ${err.message}`, 'error');
      return null;
    }
  }

  public async updateHousehold(id: string, updates: Partial<Household>): Promise<Household | null> {
    if (!this.canManage(id)) {
      this.lumberjack.logWarning('Unauthorized update attempt for household', { id }, 'HouseholdService');
      this.notifications.show('Only household owners or kitchen administrators can modify households.', 'error');
      return null;
    }

    this.lumberjack.logInfo('Updating household configuration', { id, fields: Object.keys(updates) }, 'HouseholdService');
    if (!this.supabase.hasClient) {
      let updatedHh: Household | null = null;
      const list = this.households().map(h => {
        if (h.id === id) {
          updatedHh = { ...h, ...updates };
          return updatedHh;
        }
        return h;
      });
      this.households.set(list);
      this.lumberjack.logInfo('Household updated in local mode', { id }, 'HouseholdService');
      this.notifications.show('Household updated', 'success');
      return updatedHh;
    }

    try {
      const updated = await this.supabase.updateHousehold(id, updates);
      const list = this.households().map(h => (h.id === id ? updated : h));
      this.households.set(list);
      this.lumberjack.logInfo('Household updated via Supabase backend', { id, name: updated.name }, 'HouseholdService');
      this.notifications.show(`Updated household: ${updated.name}`, 'success');
      return updated;
    } catch (err: any) {
      this.lumberjack.logError('Failed to update household', { error: err?.message || String(err), id }, 'HouseholdService');
      this.notifications.show(`Failed to update household: ${err.message}`, 'error');
      return null;
    }
  }

  public async toggleHouseholdActive(id: string): Promise<void> {
    if (!this.canManage(id)) {
      this.lumberjack.logWarning('Unauthorized toggle active attempt', { id }, 'HouseholdService');
      this.notifications.show('Only household owners or kitchen administrators can activate/deactivate households.', 'error');
      return;
    }

    const hh = this.householdsMap().get(id);
    if (!hh) return;
    this.lumberjack.logInfo('Toggling household active status', { id, newState: !hh.is_active }, 'HouseholdService');
    await this.updateHousehold(id, { is_active: !hh.is_active });
  }

  public async deleteHousehold(id: string): Promise<boolean> {
    if (!this.canManage(id)) {
      this.lumberjack.logWarning('Unauthorized delete household attempt', { id }, 'HouseholdService');
      this.notifications.show('Only administrators or household owners can delete a household.', 'error');
      return false;
    }

    const hh = this.householdsMap().get(id);
    const hhName = hh?.name || 'Household';
    const user = this.auth.currentUser();

    this.lumberjack.logInfo('Initiating household deletion', { id, name: hhName }, 'HouseholdService');
    if (!this.supabase.hasClient) {
      // 1. Remove household
      this.households.update(list => list.filter(h => h.id !== id));
      // 2. Cascade remove members
      this.householdMembers.update(list => list.filter(m => m.household_id !== id));
      // 3. Cascade remove invitations
      this.householdInvitations.update(list => list.filter(i => i.household_id !== id));

      // 4. Update user's household_ids and memberships
      if (user?.household_ids?.includes(id)) {
        const updatedIds = user.household_ids.filter(x => x !== id);
        const updatedMems = (user.memberships || []).filter(m => m.household_id !== id);
        const updatedUser = {
          ...user,
          household_ids: updatedIds,
          household_id: user.household_id === id ? (updatedIds[0] || null) : user.household_id,
          memberships: updatedMems
        };
        this.auth.currentUser.set(updatedUser);
        localStorage.setItem('tffin_auth_user', JSON.stringify(updatedUser));
      }

      // 5. Reset selected household if it was the deleted one
      if (this.selectedHouseholdId() === id) {
        this.selectedHouseholdId.set(null);
      }

      this.lumberjack.logInfo('Household deleted locally', { id, name: hhName }, 'HouseholdService');
      this.notifications.show(`Deleted household: ${hhName}`, 'success');
      return true;
    }

    try {
      await this.supabase.deleteHousehold(id, user?.id);
      this.households.update(list => list.filter(h => h.id !== id));
      this.householdMembers.update(list => list.filter(m => m.household_id !== id));
      this.householdInvitations.update(list => list.filter(i => i.household_id !== id));

      if (user?.household_ids?.includes(id)) {
        const updatedIds = user.household_ids.filter(x => x !== id);
        const updatedMems = (user.memberships || []).filter(m => m.household_id !== id);
        const updatedUser = {
          ...user,
          household_ids: updatedIds,
          household_id: user.household_id === id ? (updatedIds[0] || null) : user.household_id,
          memberships: updatedMems
        };
        this.auth.currentUser.set(updatedUser);
        localStorage.setItem('tffin_auth_user', JSON.stringify(updatedUser));
      }

      if (this.selectedHouseholdId() === id) {
        this.selectedHouseholdId.set(null);
      }

      this.lumberjack.logInfo('Household deleted in Supabase', { id, name: hhName }, 'HouseholdService');
      this.notifications.show(`Deleted household: ${hhName}`, 'success');
      return true;
    } catch (err: any) {
      this.lumberjack.logError('Failed to delete household', { error: err?.message || String(err), id }, 'HouseholdService');
      this.notifications.show(`Failed to delete household: ${err.message}`, 'error');
      return false;
    }
  }

  // Members & Invitations Management
  public async loadHouseholdMembers(householdId: string): Promise<void> {
    if (!householdId) return;
    if (!this.supabase.hasClient) {
      return;
    }

    try {
      const members = await this.supabase.fetchHouseholdMembers(householdId);
      this.householdMembers.set(members);
    } catch (err: any) {
      this.lumberjack.logWarning('Failed to load household members', { error: err?.message || String(err), householdId }, 'HouseholdService');
    }
  }

  public async loadHouseholdInvitations(householdId: string): Promise<void> {
    if (!householdId) return;
    if (!this.supabase.hasClient) {
      return;
    }

    try {
      const invs = await this.supabase.fetchHouseholdInvitations(householdId);
      this.householdInvitations.set(invs);
    } catch (err: any) {
      this.lumberjack.logWarning('Failed to load household invitations', { error: err?.message || String(err), householdId }, 'HouseholdService');
    }
  }

  public async createInviteLink(
    householdId: string,
    role: HouseholdMemberRole = 'member',
    email?: string,
    validDays: number = 7
  ): Promise<HouseholdInvitation> {
    this.lumberjack.logInfo('Generating household invite link', { householdId, role, email, validDays }, 'HouseholdService');
    if (!this.canManage(householdId)) {
      this.lumberjack.logWarning('Unauthorized invite generation attempt', { householdId }, 'HouseholdService');
      this.notifications.show('Only household owners or administrators can generate invite links.', 'error');
      throw new Error('Unauthorized to generate invite link');
    }

    const hh = this.householdsMap().get(householdId);
    const user = this.auth.currentUser();

    if (!this.supabase.hasClient) {
      const code = 'TFFN-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      const expires = new Date(Date.now() + validDays * 86400000).toISOString();
      const newInv: HouseholdInvitation = {
        id: 'inv-' + Date.now(),
        household_id: householdId,
        invited_by: user?.id,
        invite_code: code,
        email: email || undefined,
        role_in_household: role,
        status: 'pending',
        expires_at: expires,
        created_at: new Date().toISOString(),
        household_name: hh?.name || 'Household'
      };

      this.householdInvitations.update(current => [newInv, ...current]);
      this.lumberjack.logInfo('Invite created locally', { code, householdId }, 'HouseholdService');
      this.notifications.show(`Generated invite link with code: ${code}`, 'success');
      return newInv;
    }

    try {
      const inv = await this.supabase.createHouseholdInvitation(
        householdId,
        user?.id || '',
        role,
        email,
        validDays
      );
      inv.household_name = hh?.name;
      this.householdInvitations.update(current => [inv, ...current]);
      this.lumberjack.logInfo('Invite created in Supabase', { code: inv.invite_code, householdId }, 'HouseholdService');
      this.notifications.show(`Generated invite link: ${inv.invite_code}`, 'success');
      return inv;
    } catch (err: any) {
      this.lumberjack.logError('Failed to generate invite', { error: err?.message || String(err), householdId }, 'HouseholdService');
      this.notifications.show(`Failed to generate invite: ${err.message}`, 'error');
      throw err;
    }
  }

  public async revokeInvite(invitationId: string): Promise<void> {
    this.lumberjack.logInfo('Revoking household invite', { invitationId }, 'HouseholdService');
    if (!this.supabase.hasClient) {
      this.householdInvitations.update(list => 
        list.map(i => i.id === invitationId ? { ...i, status: 'revoked' as const } : i)
      );
      this.notifications.show('Invitation revoked', 'info');
      return;
    }

    try {
      await this.supabase.revokeHouseholdInvitation(invitationId);
      this.householdInvitations.update(list => 
        list.map(i => i.id === invitationId ? { ...i, status: 'revoked' as const } : i)
      );
      this.lumberjack.logInfo('Invitation revoked in Supabase', { invitationId }, 'HouseholdService');
      this.notifications.show('Invitation revoked', 'info');
    } catch (err: any) {
      this.lumberjack.logError('Failed to revoke invitation', { error: err?.message || String(err), invitationId }, 'HouseholdService');
      this.notifications.show(`Failed to revoke invitation: ${err.message}`, 'error');
    }
  }

  public async removeMember(householdId: string, userId: string): Promise<void> {
    this.lumberjack.logInfo('Removing member from household', { householdId, userId }, 'HouseholdService');
    if (!this.canManage(householdId)) {
      this.lumberjack.logWarning('Unauthorized remove member attempt', { householdId, userId }, 'HouseholdService');
      this.notifications.show('Only owners or administrators can remove members.', 'error');
      return;
    }

    const syncCurrentRemovedUser = () => {
      const user = this.auth.currentUser();
      if (user && user.id === userId) {
        const updatedIds = (user.household_ids || []).filter(id => id !== householdId);
        const updatedMems = (user.memberships || []).filter(m => m.household_id !== householdId);
        const updatedUser = {
          ...user,
          household_ids: updatedIds,
          household_id: user.household_id === householdId ? (updatedIds[0] || null) : user.household_id,
          memberships: updatedMems
        };
        this.auth.currentUser.set(updatedUser);
        localStorage.setItem('tffin_auth_user', JSON.stringify(updatedUser));
        if (this.selectedHouseholdId() === householdId) {
          this.selectedHouseholdId.set(null);
        }
      }
    };

    if (!this.supabase.hasClient) {
      this.householdMembers.update(list => 
        list.filter(m => !(m.household_id === householdId && m.user_id === userId))
      );
      syncCurrentRemovedUser();
      this.lumberjack.logInfo('Member removed locally', { householdId, userId }, 'HouseholdService');
      this.notifications.show('Member removed from household', 'info');
      return;
    }

    try {
      await this.supabase.removeHouseholdMember(householdId, userId);
      this.householdMembers.update(list => 
        list.filter(m => !(m.household_id === householdId && m.user_id === userId))
      );
      syncCurrentRemovedUser();
      this.lumberjack.logInfo('Member removed in Supabase', { householdId, userId }, 'HouseholdService');
      this.notifications.show('Member removed from household', 'info');
    } catch (err: any) {
      this.lumberjack.logError('Failed to remove member', { error: err?.message || String(err), householdId, userId }, 'HouseholdService');
      this.notifications.show(`Failed to remove member: ${err.message}`, 'error');
    }
  }

  public async acceptInviteCode(
    code: string
  ): Promise<{ success: boolean; message: string; household_id?: string; household_name?: string }> {
    const cleanCode = code.trim().toUpperCase();
    const user = this.auth.currentUser();

    this.lumberjack.logInfo('Processing accept invite code', { code: cleanCode, userId: user?.id }, 'HouseholdService');
    if (!user) {
      this.lumberjack.logWarning('Invite accept rejected: user not signed in', undefined, 'HouseholdService');
      return { success: false, message: 'Please sign in first to accept the invitation' };
    }

    if (!this.supabase.hasClient) {
      const inv = this.householdInvitations().find(i => i.invite_code.toUpperCase() === cleanCode);
      if (!inv) {
        this.lumberjack.logWarning('Invalid or unknown invite code', { code: cleanCode }, 'HouseholdService');
        return { success: false, message: 'Invalid or unknown invitation code.' };
      }
      if (inv.status !== 'pending') {
        this.lumberjack.logWarning(`Invite code already ${inv.status}`, { code: cleanCode }, 'HouseholdService');
        return { success: false, message: `This invitation code is already ${inv.status}.` };
      }

      this.householdInvitations.update(list =>
        list.map(i => i.id === inv.id ? { ...i, status: 'accepted' as const, accepted_by: user.id } : i)
      );

      const newMember: HouseholdMember = {
        id: 'hm-' + Date.now(),
        household_id: inv.household_id,
        user_id: user.id,
        role_in_household: inv.role_in_household,
        username: user.username,
        fullName: user.fullName || user.username,
        created_at: new Date().toISOString()
      };
      this.householdMembers.update(m => [...m, newMember]);

      const currentIds = user.household_ids || [];
      const currentMems = user.memberships || [];
      if (!currentIds.includes(inv.household_id)) {
        const updatedUser = {
          ...user,
          household_ids: [...currentIds, inv.household_id],
          memberships: [...currentMems, { household_id: inv.household_id, role: inv.role_in_household }]
        };
        this.auth.currentUser.set(updatedUser);
        localStorage.setItem('tffin_auth_user', JSON.stringify(updatedUser));
      }

      const hh = this.householdsMap().get(inv.household_id);
      this.lumberjack.logInfo('Invite accepted locally', { code: cleanCode, householdId: inv.household_id }, 'HouseholdService');
      this.notifications.show(`Successfully joined ${hh?.name || 'household'}!`, 'success');
      return {
        success: true,
        message: `Successfully joined ${hh?.name || 'household'}!`,
        household_id: inv.household_id,
        household_name: hh?.name
      };
    }

    try {
      const res = await this.supabase.acceptHouseholdInvitation(cleanCode, user.id);
      if (res.success && res.household_id) {
        await this.loadFromSupabase();
        await this.auth.refreshCurrentUser();
        await this.loadHouseholdMembers(res.household_id);
        this.lumberjack.logInfo('Invite accepted in Supabase', { code: cleanCode, householdId: res.household_id }, 'HouseholdService');
        this.notifications.show(res.message, 'success');
      } else {
        this.lumberjack.logWarning('Failed to accept invite in Supabase', { code: cleanCode, message: res.message }, 'HouseholdService');
        this.notifications.show(res.message, 'error');
      }
      return res;
    } catch (err: any) {
      const msg = err.message || 'Error processing invitation code';
      this.lumberjack.logError('Error accepting invitation', { error: err?.message || String(err), code: cleanCode }, 'HouseholdService');
      this.notifications.show(msg, 'error');
      return { success: false, message: msg };
    }
  }
}
