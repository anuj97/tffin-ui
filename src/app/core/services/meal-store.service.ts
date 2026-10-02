import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { Ingredient } from '../models/ingredient.model';
import { InventoryItem } from '../models/inventory.model';
import { Dish } from '../models/dish.model';
import { Household, HouseholdMember, HouseholdInvitation, HouseholdMemberRole } from '../models/household.model';
import { MealSchedule, MealStockStatus, MealType, ShortageReportItem } from '../models/meal-schedule.model';
import {
  MOCK_HOUSEHOLDS,
  MOCK_HOUSEHOLD_MEMBERS,
  MOCK_INVITATIONS,
  MOCK_INGREDIENTS,
  MOCK_INVENTORY,
  MOCK_DISHES,
  generateMockSchedules
} from '../mock/mock-data';

export function getTodayString(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

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

export interface SlotHouseholdPlan {
  schedule: MealSchedule;
  household: Household | null;
  dish: Dish | null;
  stockStatus: MealStockStatus | null;
}

export interface DayMealSlot {
  mealType: MealType;
  schedule: MealSchedule | null;
  dish: Dish | null;
  stockStatus: MealStockStatus | null;
  householdPlans: SlotHouseholdPlan[];
  totalHeadcount: number;
}

@Injectable({
  providedIn: 'root'
})
export class MealStoreService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

  // State Signals
  public households = signal<Household[]>([DEFAULT_HOUSEHOLD]);
  public householdMembers = signal<HouseholdMember[]>([]);
  public householdInvitations = signal<HouseholdInvitation[]>([]);
  public selectedHouseholdId = signal<string | null>(null); // null = "All Households"
  public ingredients = signal<Ingredient[]>([]);
  public inventory = signal<InventoryItem[]>([]);
  public dishes = signal<Dish[]>([]);
  public schedules = signal<MealSchedule[]>([]);
  public isLoading = signal<boolean>(false);
  public lastError = signal<string | null>(null);
  public notification = signal<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  public isDebugMode = signal<boolean>(!this.supabase.hasClient);

  constructor() {
    this.init();
  }

  public async init(): Promise<void> {
    if (!this.supabase.hasClient) {
      this.isDebugMode.set(true);
      this.loadMockData();
      return;
    }

    this.isLoading.set(true);
    try {
      await this.loadFromSupabase();
      this.isDebugMode.set(false);
    } catch (err: any) {
      console.warn('Failed to load from Supabase, activating local mock data:', err);
      this.isDebugMode.set(true);
      this.loadMockData();
    } finally {
      this.isLoading.set(false);
    }
  }

  public loadMockData(): void {
    this.households.set([...MOCK_HOUSEHOLDS]);
    this.householdMembers.set([...MOCK_HOUSEHOLD_MEMBERS]);
    this.householdInvitations.set([...MOCK_INVITATIONS]);
    this.ingredients.set([...MOCK_INGREDIENTS]);
    this.inventory.set([...MOCK_INVENTORY]);
    this.dishes.set([...MOCK_DISHES]);
    this.schedules.set(generateMockSchedules());
    this.selectedHouseholdId.set(null);
  }

  public clearState(): void {
    this.ingredients.set([]);
    this.inventory.set([]);
    this.dishes.set([]);
    this.schedules.set([]);
    this.households.set([DEFAULT_HOUSEHOLD]);
    this.selectedHouseholdId.set(null);
  }

  public async loadFromSupabase(): Promise<void> {
    try {
      this.lastError.set(null);
      const [hhs, ings, invs, dshs] = await Promise.all([
        this.supabase.fetchHouseholds(),
        this.supabase.fetchIngredients(),
        this.supabase.fetchInventory(),
        this.supabase.fetchDishes()
      ]);

      if (hhs && hhs.length > 0) {
        this.households.set(hhs);
      } else {
        this.households.set([DEFAULT_HOUSEHOLD]);
      }

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

  // Lookups & Computeds
  // Authorized households that the current signed-in user is a part of
  public authorizedHouseholds = computed(() => {
    const user = this.auth.currentUser();
    const all = this.households().filter(h => h.is_active);

    if (!user) return all.length > 0 ? all : [DEFAULT_HOUSEHOLD];

    // Explicit household_ids (multi-household membership)
    if (user.household_ids && user.household_ids.length > 0) {
      const allowedSet = new Set(user.household_ids);
      const filtered = all.filter(h => allowedSet.has(h.id));
      return filtered.length > 0 ? filtered : [];
    }

    // Single household_id assignment
    if (user.household_id) {
      const filtered = all.filter(h => h.id === user.household_id);
      return filtered.length > 0 ? filtered : [];
    }

    // Unrestricted admin / kitchen staff / owner
    if (user.role === 'admin' || user.role === 'chef' || user.role === 'owner') {
      return all.length > 0 ? all : [DEFAULT_HOUSEHOLD];
    }

    return [];
  });

  public authorizedHouseholdIds = computed(() => {
    return new Set(this.authorizedHouseholds().map(h => h.id));
  });

  public activeHouseholds = computed(() => {
    return this.authorizedHouseholds();
  });

  public effectiveHouseholdId = computed(() => {
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

  public getMealsForDate(dateStr: string, householdId?: string | null): DayMealSlot[] {
    const filterHhId = householdId !== undefined ? householdId : this.effectiveHouseholdId();
    const authHhIds = this.authorizedHouseholdIds();

    // Enforce authorization: only show schedules for households the user is authorized to see
    let daySchedules = this.schedules().filter(s => 
      s.schedule_date === dateStr && authHhIds.has(s.household_id)
    );

    if (filterHhId) {
      daySchedules = daySchedules.filter(s => s.household_id === filterHhId);
    }

    const dMap = this.dishesMap();
    const hhMap = this.householdsMap();

    const types: MealType[] = ['breakfast', 'lunch', 'dinner'];
    return types.map(type => {
      const typeSchedules = daySchedules.filter(s => s.meal_type === type);
      const firstSchedule = typeSchedules[0] || null;
      const dish = firstSchedule ? dMap.get(firstSchedule.dish_id) : undefined;
      const stockStatus = firstSchedule && dish ? this.calculateMealStockStatus(dish, firstSchedule.headcount) : null;

      const householdPlans: SlotHouseholdPlan[] = typeSchedules.map(sched => {
        const d = dMap.get(sched.dish_id) || null;
        const hh = sched.household || hhMap.get(sched.household_id) || null;
        const status = d ? this.calculateMealStockStatus(d, sched.headcount) : null;
        return {
          schedule: sched,
          household: hh,
          dish: d,
          stockStatus: status
        };
      });

      const totalHeadcount = typeSchedules.reduce((sum, s) => sum + (s.headcount || 0), 0);

      return {
        mealType: type,
        schedule: firstSchedule,
        dish: dish || null,
        stockStatus,
        householdPlans,
        totalHeadcount
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

  // Smart Grocery Shortage List for upcoming N days (only aggregates for authorized households)
  public calculateShortages(daysAhead: number = 4, householdId?: string | null): ShortageReportItem[] {
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + daysAhead);

    const todayStr = today.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const filterHhId = householdId !== undefined ? householdId : this.effectiveHouseholdId();
    const authHhIds = this.authorizedHouseholdIds();

    let targetSchedules = this.schedules().filter(
      s => s.schedule_date >= todayStr && s.schedule_date <= endStr && authHhIds.has(s.household_id)
    );
    if (filterHhId) {
      targetSchedules = targetSchedules.filter(s => s.household_id === filterHhId);
    }

    const ingMap = this.ingredientsMap();
    const invMap = this.inventoryMap();
    const dMap = this.dishesMap();

    // Sum required quantities per ingredient across all matching households
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

  // Household Selection & Management
  public setSelectedHousehold(id: string | null): void {
    this.selectedHouseholdId.set(id);
  }

  public async createHousehold(household: Partial<Household>): Promise<Household | null> {
    const role = this.auth.currentUser()?.role;
    if (role && !['admin', 'owner'].includes(role)) {
      this.showNotification('Only kitchen administrators can create households.', 'error');
      return null;
    }

    if (!this.supabase.hasClient) {
      const newHh: Household = {
        id: 'hh-' + Date.now(),
        name: household.name || 'New Household',
        code: household.code || `HH-${this.households().length + 1}`,
        contact_name: household.contact_name || '',
        contact_phone: household.contact_phone || '',
        address: household.address || '',
        default_headcount: household.default_headcount || 2,
        dietary_notes: household.dietary_notes || '',
        color_tag: household.color_tag || '#6366f1',
        is_active: household.is_active ?? true,
        created_at: new Date().toISOString()
      };
      this.households.set([...this.households(), newHh]);
      this.showNotification(`Created household: ${newHh.name}`, 'success');
      return newHh;
    }

    try {
      const created = await this.supabase.createHousehold(household);
      this.households.set([...this.households(), created]);
      this.showNotification(`Created household: ${created.name}`, 'success');
      return created;
    } catch (err: any) {
      this.showNotification(`Failed to create household: ${err.message}`, 'error');
      return null;
    }
  }

  public async updateHousehold(id: string, updates: Partial<Household>): Promise<void> {
    const role = this.auth.currentUser()?.role;
    if (role && !['admin', 'owner'].includes(role)) {
      this.showNotification('Only kitchen administrators can modify households.', 'error');
      return;
    }

    if (!this.supabase.hasClient) {
      const list = this.households().map(h => (h.id === id ? { ...h, ...updates } : h));
      this.households.set(list);
      this.showNotification('Household updated', 'success');
      return;
    }

    try {
      const updated = await this.supabase.updateHousehold(id, updates);
      const list = this.households().map(h => (h.id === id ? updated : h));
      this.households.set(list);
      this.showNotification(`Updated household: ${updated.name}`, 'success');
    } catch (err: any) {
      this.showNotification(`Failed to update household: ${err.message}`, 'error');
    }
  }

  public async toggleHouseholdActive(id: string): Promise<void> {
    const role = this.auth.currentUser()?.role;
    if (role && !['admin', 'owner'].includes(role)) {
      this.showNotification('Only kitchen administrators can activate/deactivate households.', 'error');
      return;
    }

    const hh = this.householdsMap().get(id);
    if (!hh) return;
    await this.updateHousehold(id, { is_active: !hh.is_active });
  }

  // Household Members & Invitations Management
  public async loadHouseholdMembers(householdId: string): Promise<void> {
    if (!householdId) return;
    if (!this.supabase.hasClient) {
      const members = this.householdMembers().filter(m => m.household_id === householdId);
      if (members.length === 0) {
        // Fallback to MOCK_HOUSEHOLD_MEMBERS
        const mockFiltered = MOCK_HOUSEHOLD_MEMBERS.filter(m => m.household_id === householdId);
        if (mockFiltered.length > 0) {
          this.householdMembers.update(curr => [...curr, ...mockFiltered]);
        }
      }
      return;
    }

    try {
      const members = await this.supabase.fetchHouseholdMembers(householdId);
      this.householdMembers.set(members);
    } catch (err: any) {
      console.warn('Failed to load household members:', err.message);
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
      console.warn('Failed to load household invitations:', err.message);
    }
  }

  public async createInviteLink(
    householdId: string,
    role: HouseholdMemberRole = 'member',
    email?: string,
    validDays: number = 7
  ): Promise<HouseholdInvitation> {
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
      this.showNotification(`Generated invite link with code: ${code}`, 'success');
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
      this.showNotification(`Generated invite link: ${inv.invite_code}`, 'success');
      return inv;
    } catch (err: any) {
      this.showNotification(`Failed to generate invite: ${err.message}`, 'error');
      throw err;
    }
  }

  public async revokeInvite(invitationId: string): Promise<void> {
    if (!this.supabase.hasClient) {
      this.householdInvitations.update(list => 
        list.map(i => i.id === invitationId ? { ...i, status: 'revoked' as const } : i)
      );
      this.showNotification('Invitation revoked', 'info');
      return;
    }

    try {
      await this.supabase.revokeHouseholdInvitation(invitationId);
      this.householdInvitations.update(list => 
        list.map(i => i.id === invitationId ? { ...i, status: 'revoked' as const } : i)
      );
      this.showNotification('Invitation revoked', 'info');
    } catch (err: any) {
      this.showNotification(`Failed to revoke invitation: ${err.message}`, 'error');
    }
  }

  public async removeMember(householdId: string, userId: string): Promise<void> {
    const role = this.auth.currentUser()?.role;
    if (role && !['admin', 'owner'].includes(role)) {
      this.showNotification('Only owners or administrators can remove members.', 'error');
      return;
    }

    if (!this.supabase.hasClient) {
      this.householdMembers.update(list => 
        list.filter(m => !(m.household_id === householdId && m.user_id === userId))
      );
      this.showNotification('Member removed from household', 'info');
      return;
    }

    try {
      await this.supabase.removeHouseholdMember(householdId, userId);
      this.householdMembers.update(list => 
        list.filter(m => !(m.household_id === householdId && m.user_id === userId))
      );
      this.showNotification('Member removed from household', 'info');
    } catch (err: any) {
      this.showNotification(`Failed to remove member: ${err.message}`, 'error');
    }
  }

  public async acceptInviteCode(
    code: string
  ): Promise<{ success: boolean; message: string; household_id?: string; household_name?: string }> {
    const cleanCode = code.trim().toUpperCase();
    const user = this.auth.currentUser();

    if (!user) {
      return { success: false, message: 'Please sign in first to accept the invitation' };
    }

    if (!this.supabase.hasClient) {
      const inv = this.householdInvitations().find(i => i.invite_code.toUpperCase() === cleanCode);
      if (!inv) {
        return { success: false, message: 'Invalid or unknown invitation code.' };
      }
      if (inv.status !== 'pending') {
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
      if (!currentIds.includes(inv.household_id)) {
        const updatedUser = { ...user, household_ids: [...currentIds, inv.household_id] };
        this.auth.currentUser.set(updatedUser);
        localStorage.setItem('tffin_auth_user', JSON.stringify(updatedUser));
      }

      const hh = this.householdsMap().get(inv.household_id);
      this.showNotification(`Successfully joined ${hh?.name || 'household'}!`, 'success');
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
        const currentIds = user.household_ids || [];
        if (!currentIds.includes(res.household_id)) {
          const updatedUser = { ...user, household_ids: [...currentIds, res.household_id] };
          this.auth.currentUser.set(updatedUser);
          localStorage.setItem('tffin_auth_user', JSON.stringify(updatedUser));
        }
        await this.loadHouseholdMembers(res.household_id);
        this.showNotification(res.message, 'success');
      } else {
        this.showNotification(res.message, 'error');
      }
      return res;
    } catch (err: any) {
      const msg = err.message || 'Error processing invitation code';
      this.showNotification(msg, 'error');
      return { success: false, message: msg };
    }
  }

  // State Mutations with Optimistic Updates
  public async adjustHeadcount(
    scheduleDate: string,
    mealType: MealType,
    delta: number,
    householdId?: string
  ): Promise<void> {
    const effectiveHhId = householdId || this.effectiveHouseholdId() || this.authorizedHouseholds()[0]?.id || DEFAULT_HOUSEHOLD.id;

    if (!this.authorizedHouseholdIds().has(effectiveHhId)) {
      this.showNotification('You do not have permission to modify meals for this household.', 'error');
      return;
    }

    // 1. Optimistic local update
    const current = this.schedules();
    const existingIndex = current.findIndex(
      s => s.schedule_date === scheduleDate && s.meal_type === mealType && (s.household_id === effectiveHhId || !s.household_id)
    );

    if (existingIndex >= 0) {
      const target = current[existingIndex];
      const newCount = Math.max(0, target.headcount + delta);
      const updated = [...current];
      updated[existingIndex] = { ...target, headcount: newCount, household_id: effectiveHhId };
      this.schedules.set(updated);

      if (this.supabase.hasClient) {
        try {
          await this.supabase.updateHeadcountRPC(effectiveHhId, scheduleDate, mealType, delta);
        } catch (err: any) {
          this.showNotification(`Error updating headcount: ${err.message}`, 'error');
          this.schedules.set(current);
        }
      }
    }
  }

  public async setMealSchedule(
    schedule_date: string,
    meal_type: MealType,
    dish_id: string,
    headcount?: number,
    household_id?: string
  ): Promise<void> {
    const targetHhId = household_id || this.effectiveHouseholdId() || this.authorizedHouseholds()[0]?.id || DEFAULT_HOUSEHOLD.id;

    if (!this.authorizedHouseholdIds().has(targetHhId)) {
      this.showNotification('You do not have permission to plan meals for this household.', 'error');
      return;
    }

    const targetHh = this.householdsMap().get(targetHhId);
    const finalHeadcount = headcount !== undefined ? headcount : (targetHh?.default_headcount || 3);

    const current = this.schedules();
    const existingIndex = current.findIndex(
      s => s.schedule_date === schedule_date && s.meal_type === meal_type && s.household_id === targetHhId
    );

    if (!this.supabase.hasClient) {
      if (existingIndex >= 0) {
        const list = [...current];
        list[existingIndex] = { ...current[existingIndex], dish_id, headcount: finalHeadcount, household_id: targetHhId, household: targetHh };
        this.schedules.set(list);
      } else {
        const newSched: MealSchedule = {
          id: 'sched-' + Date.now(),
          schedule_date,
          meal_type,
          dish_id,
          headcount: finalHeadcount,
          household_id: targetHhId,
          household: targetHh
        };
        this.schedules.set([...current, newSched]);
      }
      this.showNotification(`Meal scheduled for ${meal_type} (${targetHh?.name || 'Household'})`, 'success');
      return;
    }

    try {
      const saved = await this.supabase.upsertMealSchedule(schedule_date, meal_type, dish_id, finalHeadcount, targetHhId);
      if (existingIndex >= 0) {
        const list = [...current];
        list[existingIndex] = { ...current[existingIndex], dish_id, headcount: finalHeadcount, household_id: targetHhId, household: targetHh };
        this.schedules.set(list);
      } else {
        this.schedules.set([...current, { ...saved, household: targetHh }]);
      }
      this.showNotification(`Meal scheduled for ${meal_type} (${targetHh?.name || 'Household'}) on ${schedule_date}`, 'success');
    } catch (err: any) {
      this.showNotification(`Error saving schedule: ${err.message}`, 'error');
    }
  }

  public async updateInventoryQuantity(ingredientId: string, newQuantity: number, minThreshold?: number): Promise<void> {
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

      if (this.supabase.hasClient) {
        try {
          await this.supabase.updateInventory(ingredientId, item.quantity, item.min_threshold);
        } catch (err: any) {
          this.showNotification(`Error updating inventory: ${err.message}`, 'error');
          this.inventory.set(current);
        }
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
    const newId = 'ing-' + Date.now();
    const newIng: Ingredient = { id: newId, name, category, unit };

    if (!this.supabase.hasClient) {
      this.ingredients.set([...this.ingredients(), newIng]);
      this.inventory.set([
        ...this.inventory(),
        {
          id: 'inv-' + Date.now(),
          ingredient_id: newId,
          quantity: initialStock,
          min_threshold: minThreshold,
          updated_at: new Date().toISOString()
        }
      ]);
      this.showNotification(`Added ingredient: ${name}`, 'success');
      return;
    }

    try {
      const created = await this.supabase.createIngredient(
        { name, category, unit },
        initialStock,
        minThreshold
      );
      this.ingredients.set([...this.ingredients(), created]);
      this.inventory.set([
        ...this.inventory(),
        {
          id: 'inv-' + Date.now(),
          ingredient_id: created.id,
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
    const dishId = 'dish-' + Date.now();

    if (!this.supabase.hasClient) {
      const newDish: Dish = {
        id: dishId,
        name,
        cook_notes: cookNotes,
        recipe_ingredients: recipeIngredients.map((r, i) => ({
          id: `ri-${dishId}-${i}`,
          dish_id: dishId,
          ingredient_id: r.ingredient_id,
          qty_per_person: r.qty_per_person
        }))
      };
      this.dishes.set([...this.dishes(), newDish]);
      this.showNotification(`Created dish: ${name}`, 'success');
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
      this.dishes.set(this.dishes().filter(d => d.id !== dishId));
      this.showNotification('Dish removed', 'info');
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
