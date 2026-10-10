import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { LumberjackService } from '@ngworker/lumberjack';
import { Household, HouseholdMember, HouseholdInvitation, HouseholdMemberRole } from '../models/household.model';
import { AppUser, UserHouseholdMembership } from '../models/user.model';

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
  private lastSyncedUserId: string | null = null;

  // State Signals
  public households = signal<Household[]>([DEFAULT_HOUSEHOLD]);
  public householdMembers = signal<HouseholdMember[]>([]);
  public householdInvitations = signal<HouseholdInvitation[]>([]);
  public selectedHouseholdId = signal<string | null>(null); // null = "All Households"
  public isLoading = signal<boolean>(false);
  public lastError = signal<string | null>(null);

  constructor() {
    this.init();

    // Automatically re-sync households only when the authenticated user ID changes
    effect(() => {
      const user = this.auth.currentUser();
      const userId = user?.id || null;
      if (this.supabase.hasClient && userId && userId !== this.lastSyncedUserId) {
        this.lastSyncedUserId = userId;
        untracked(() => {
          this.loadFromSupabase().catch(err => {
            this.lumberjack.logWarning('Failed to load households for user session', { error: err?.message || String(err) }, 'HouseholdService');
          });
        });
      } else if (!userId) {
        this.lastSyncedUserId = null;
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
      this.lastSyncedUserId = this.auth.currentUser()?.id || null;
      await this.loadFromSupabase();
    } catch (err: any) {
      this.lumberjack.logWarning('Failed to load households from Supabase', { error: err?.message || String(err) }, 'HouseholdService');
    } finally {
      this.isLoading.set(false);
    }
  }

  public clearState(): void {
    this.lastSyncedUserId = null;
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

        if (userId) {
          try {
            const freshProfile = await this.supabase.fetchAppUserById(userId);
            if (freshProfile) {
              this.persistSessionUser(freshProfile);
            }
          } catch (e) {
            this.lumberjack.logWarning('Could not refresh user profile in loadFromSupabase', { error: String(e) }, 'HouseholdService');
          }
        }

        await Promise.all(
          hhs.map(hh =>
            Promise.all([
              this.loadHouseholdMembers(hh.id),
              this.loadHouseholdInvitations(hh.id)
            ])
          )
        );
      } else {
        const user = this.auth.currentUser();
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

  // Single Computed Source of Truth for User Memberships & Roles
  public userMemberships = computed<UserHouseholdMembership[]>(() => {
    const user = this.auth.currentUser();
    if (!user) return [];

    const rosterByHh = new Map<string, HouseholdMemberRole>();
    for (const m of this.householdMembers()) {
      if (m.user_id === user.id) {
        rosterByHh.set(m.household_id, m.role_in_household);
      }
    }

    // When user.memberships is populated, it is strictly authoritative for which households the user belongs to
    if (user.memberships && user.memberships.length > 0) {
      return user.memberships.map(m => ({
        household_id: m.household_id,
        role: rosterByHh.get(m.household_id) || m.role
      }));
    }

    // Fallback for legacy/fixture users without memberships array
    const fallbackIds = new Set<string>(user.household_ids || []);
    if (user.household_id) fallbackIds.add(user.household_id);
    for (const hhId of rosterByHh.keys()) fallbackIds.add(hhId);

    const defaultRole: HouseholdMemberRole = user.role === 'owner' ? 'owner' : 'member';
    return Array.from(fallbackIds).map(hhId => ({
      household_id: hhId,
      role: rosterByHh.get(hhId) || defaultRole
    }));
  });

  // Authorized households that the current signed-in user is a part of
  public authorizedHouseholds = computed<Household[]>(() => {
    const user = this.auth.currentUser();
    const all = this.households().filter(h => h.is_active !== false);

    if (!user || user.role === 'admin' || user.role === 'chef') {
      return all.length > 0 ? all : [DEFAULT_HOUSEHOLD];
    }

    const allowedIds = new Set(this.userMemberships().map(m => m.household_id));
    if (allowedIds.size > 0) {
      return all.filter(h => allowedIds.has(h.id));
    }

    // In Supabase mode, this.households() was already filtered by get_authorized_households(user.id)
    if (this.supabase.hasClient && all.length > 0) {
      return all;
    }

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

  // Household Selection & Target Resolution
  public setSelectedHousehold(id: string | null): void {
    this.selectedHouseholdId.set(id);
  }

  public resolveTargetHouseholdId(preferredId?: string | null): string {
    const authIds = this.authorizedHouseholdIds();
    if (preferredId && authIds.has(preferredId)) {
      return preferredId;
    }
    const eff = this.effectiveHouseholdId();
    if (eff && authIds.has(eff)) {
      return eff;
    }
    const sel = this.selectedHouseholdId();
    if (sel && authIds.has(sel)) {
      return sel;
    }
    return this.activeHouseholds()[0]?.id || '';
  }

  // Role and Permission Resolution
  public getRoleInHousehold(householdId: string): HouseholdMemberRole | null {
    const user = this.auth.currentUser();
    if (!user) return null;

    if (user.role === 'admin') return 'owner';
    if (user.role === 'chef') return 'member';

    const membership = this.userMemberships().find(m => m.household_id === householdId);
    if (membership) return membership.role;

    if (user.memberships && user.memberships.length > 0) {
      return null;
    }

    if (this.authorizedHouseholdIds().has(householdId)) {
      return (user.role === 'owner' ? 'owner' : 'member') as HouseholdMemberRole;
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
    if (authed.length === 0) return true;
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

  // Centralized User Membership Session Sync Helpers
  private persistSessionUser(user: AppUser): void {
    if (typeof (this.auth as any).setSessionUser === 'function') {
      this.auth.setSessionUser(user);
    } else {
      this.auth.currentUser.set(user);
      try {
        localStorage.setItem('tffin_auth_user', JSON.stringify(user));
      } catch {}
    }
  }

  private addUserMembership(householdId: string, role: HouseholdMemberRole, setAsPrimary: boolean = false): void {
    const user = this.auth.currentUser();
    if (!user) return;

    const currentIds = user.household_ids || [];
    const currentMems = (user.memberships || []).filter(m => m.household_id !== householdId);
    const nextIds = currentIds.includes(householdId) ? currentIds : [...currentIds, householdId];

    this.persistSessionUser({
      ...user,
      household_id: setAsPrimary ? householdId : (user.household_id || householdId),
      household_ids: nextIds,
      memberships: [...currentMems, { household_id: householdId, role }]
    });
  }

  private removeUserMembership(householdId: string): void {
    const user = this.auth.currentUser();
    if (!user) return;

    const hasId = user.household_id === householdId ||
      user.household_ids?.includes(householdId) ||
      user.memberships?.some(m => m.household_id === householdId);
    if (!hasId) return;

    const updatedIds = (user.household_ids || []).filter(id => id !== householdId);
    const updatedMems = (user.memberships || []).filter(m => m.household_id !== householdId);

    this.persistSessionUser({
      ...user,
      household_ids: updatedIds,
      household_id: user.household_id === householdId ? (updatedIds[0] || null) : user.household_id,
      memberships: updatedMems
    });
  }

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

    try {
      const created: Household = this.supabase.hasClient
        ? await this.supabase.createHousehold(household, user?.id)
        : {
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

      this.households.set([...this.households(), created]);

      if (user) {
        const isStaff = ['admin', 'chef'].includes(user.role);
        if (!isStaff || isUnassignedUser) {
          const newMember: HouseholdMember = {
            id: 'hm-' + Date.now(),
            household_id: created.id,
            user_id: user.id,
            role_in_household: 'owner',
            username: user.username,
            fullName: user.fullName || user.username
          };
          this.householdMembers.update(members => [
            ...members.filter(m => !(m.household_id === created.id && m.user_id === user.id)),
            newMember
          ]);
          this.addUserMembership(created.id, 'owner', true);
        }
      }

      this.selectedHouseholdId.set(created.id);
      this.lumberjack.logInfo('Household created successfully', { id: created.id, name: created.name }, 'HouseholdService');
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
    const existing = this.householdsMap().get(id);
    if (!existing && !this.supabase.hasClient) return null;

    try {
      const updated: Household = this.supabase.hasClient
        ? await this.supabase.updateHousehold(id, updates)
        : { ...existing!, ...updates };

      this.households.update(list => list.map(h => (h.id === id ? updated : h)));
      this.lumberjack.logInfo('Household updated successfully', { id, name: updated.name }, 'HouseholdService');
      this.notifications.show(this.supabase.hasClient ? `Updated household: ${updated.name}` : 'Household updated', 'success');
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
    try {
      if (this.supabase.hasClient) {
        await this.supabase.deleteHousehold(id, user?.id);
      }

      this.households.update(list => list.filter(h => h.id !== id));
      this.householdMembers.update(list => list.filter(m => m.household_id !== id));
      this.householdInvitations.update(list => list.filter(i => i.household_id !== id));
      this.removeUserMembership(id);

      if (this.selectedHouseholdId() === id) {
        this.selectedHouseholdId.set(null);
      }

      this.lumberjack.logInfo('Household deleted successfully', { id, name: hhName }, 'HouseholdService');
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
    if (!householdId || !this.supabase.hasClient) return;

    try {
      const members = await this.supabase.fetchHouseholdMembers(householdId);
      this.householdMembers.update(current => [
        ...current.filter(m => m.household_id !== householdId),
        ...members
      ]);
    } catch (err: any) {
      this.lumberjack.logWarning('Failed to load household members', { error: err?.message || String(err), householdId }, 'HouseholdService');
    }
  }

  public async loadHouseholdInvitations(householdId: string): Promise<void> {
    if (!householdId || !this.supabase.hasClient) return;

    try {
      const invs = await this.supabase.fetchHouseholdInvitations(householdId);
      this.householdInvitations.update(current => [
        ...current.filter(i => i.household_id !== householdId),
        ...invs
      ]);
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

    try {
      const inv: HouseholdInvitation = this.supabase.hasClient
        ? await this.supabase.createHouseholdInvitation(householdId, user?.id || '', role, email, validDays)
        : {
            id: 'inv-' + Date.now(),
            household_id: householdId,
            invited_by: user?.id,
            invite_code: 'TFFN-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
            email: email || undefined,
            role_in_household: role,
            status: 'pending',
            expires_at: new Date(Date.now() + validDays * 86400000).toISOString(),
            created_at: new Date().toISOString()
          };

      inv.household_name = hh?.name || 'Household';
      this.householdInvitations.update(current => [inv, ...current]);
      this.lumberjack.logInfo('Invite created successfully', { code: inv.invite_code, householdId }, 'HouseholdService');
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
    try {
      if (this.supabase.hasClient) {
        await this.supabase.revokeHouseholdInvitation(invitationId);
      }
      this.householdInvitations.update(list =>
        list.map(i => (i.id === invitationId ? { ...i, status: 'revoked' as const } : i))
      );
      this.lumberjack.logInfo('Invitation revoked', { invitationId }, 'HouseholdService');
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

    try {
      if (this.supabase.hasClient) {
        await this.supabase.removeHouseholdMember(householdId, userId);
      }

      this.householdMembers.update(list =>
        list.filter(m => !(m.household_id === householdId && m.user_id === userId))
      );

      if (this.auth.currentUser()?.id === userId) {
        this.removeUserMembership(householdId);
        if (this.selectedHouseholdId() === householdId) {
          this.selectedHouseholdId.set(null);
        }
      }

      this.lumberjack.logInfo('Member removed successfully', { householdId, userId }, 'HouseholdService');
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
        list.map(i => (i.id === inv.id ? { ...i, status: 'accepted' as const, accepted_by: user.id } : i))
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
      this.addUserMembership(inv.household_id, inv.role_in_household);

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
