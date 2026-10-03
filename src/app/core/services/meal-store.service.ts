import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { HouseholdService, DEFAULT_HOUSEHOLD } from './household.service';
import { NotificationService } from './notification.service';
import { LumberjackService } from '@ngworker/lumberjack';
import { Ingredient } from '../models/ingredient.model';
import { InventoryItem } from '../models/inventory.model';
import { Dish } from '../models/dish.model';
import { Household, HouseholdMember, HouseholdInvitation, HouseholdMemberRole } from '../models/household.model';
import { MealSchedule, MealStockStatus, MealType, ShortageReportItem } from '../models/meal-schedule.model';
import {
  MOCK_INGREDIENTS,
  MOCK_INVENTORY,
  MOCK_DISHES,
  generateMockSchedules
} from '../mock/mock-data';

export { DEFAULT_HOUSEHOLD };

export function getTodayString(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

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
  private lumberjack = inject(LumberjackService);
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);
  public householdService = inject(HouseholdService);
  private notifications = inject(NotificationService);

  // Delegated Household State Signals & Computeds
  public households = this.householdService.households;
  public householdMembers = this.householdService.householdMembers;
  public householdInvitations = this.householdService.householdInvitations;
  public selectedHouseholdId = this.householdService.selectedHouseholdId;
  public authorizedHouseholds = this.householdService.authorizedHouseholds;
  public authorizedHouseholdIds = this.householdService.authorizedHouseholdIds;
  public activeHouseholds = this.householdService.activeHouseholds;
  public effectiveHouseholdId = this.householdService.effectiveHouseholdId;
  public householdsMap = this.householdService.householdsMap;
  public selectedHousehold = this.householdService.selectedHousehold;

  // Domain State Signals
  public ingredients = signal<Ingredient[]>([]);
  public inventory = signal<InventoryItem[]>([]);
  public dishes = signal<Dish[]>([]);
  public schedules = signal<MealSchedule[]>([]);
  public isLoading = signal<boolean>(false);
  public lastError = signal<string | null>(null);
  public notification = this.notifications.notification;
  public isDebugMode = signal<boolean>(!this.supabase.hasClient);

  constructor() {
    this.init();

    // Automatically synchronize Supabase store when authenticated user changes or resolves
    effect(() => {
      const user = this.auth.currentUser();
      if (this.supabase.hasClient && user) {
        untracked(() => {
          this.loadFromSupabase().catch(err => {
            this.lumberjack.logWarning('Failed to re-sync meal store for user', { error: err?.message || String(err) }, 'MealStoreService');
          });
        });
      }
    });

    // Auto-prune schedules when households are removed
    effect(() => {
      const activeIds = new Set(this.householdService.households().map(h => h.id));
      untracked(() => {
        const cur = this.schedules();
        const filtered = cur.filter(s => !s.household_id || activeIds.has(s.household_id));
        if (filtered.length !== cur.length) {
          this.lumberjack.logInfo(`Pruned ${cur.length - filtered.length} schedules for inactive households`, undefined, 'MealStoreService');
          this.schedules.set(filtered);
        }
      });
    });
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
      this.lumberjack.logWarning('Failed to load from Supabase, activating local mock data', { error: err?.message || String(err) }, 'MealStoreService');
      this.isDebugMode.set(true);
      this.loadMockData();
    } finally {
      this.isLoading.set(false);
    }
  }

  public loadMockData(): void {
    this.householdService.loadMockData();
    this.ingredients.set([...MOCK_INGREDIENTS]);
    this.inventory.set([...MOCK_INVENTORY]);
    this.dishes.set([...MOCK_DISHES]);
    this.schedules.set(generateMockSchedules());
  }

  public clearState(): void {
    this.householdService.clearState();
    this.ingredients.set([]);
    this.inventory.set([]);
    this.dishes.set([]);
    this.schedules.set([]);
  }

  public async loadFromSupabase(): Promise<void> {
    try {
      this.lastError.set(null);
      await this.householdService.loadFromSupabase();

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
      this.lumberjack.logInfo('Meal store synchronized from Supabase', {
        ingredientsCount: ings.length,
        inventoryCount: invs.length,
        dishesCount: dshs.length,
        schedulesCount: scheds.length
      }, 'MealStoreService');
    } catch (err: any) {
      this.lumberjack.logError('Failed to load meal store from Supabase', { error: err?.message || String(err) }, 'MealStoreService');
      this.lastError.set(err.message || 'Failed to load meal store from Supabase');
      throw err;
    }
  }

  // Lookups & Computeds
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

  // Delegated Household Management Helpers
  public setSelectedHousehold(id: string | null): void {
    this.householdService.setSelectedHousehold(id);
  }

  public createHousehold(household: Partial<Household>): Promise<Household | null> {
    return this.householdService.createHousehold(household);
  }

  public updateHousehold(id: string, updates: Partial<Household>): Promise<Household | null> {
    return this.householdService.updateHousehold(id, updates);
  }

  public toggleHouseholdActive(id: string): Promise<void> {
    return this.householdService.toggleHouseholdActive(id);
  }

  public async deleteHousehold(id: string): Promise<boolean> {
    const success = await this.householdService.deleteHousehold(id);
    if (success) {
      this.schedules.update(list => list.filter(s => s.household_id !== id));
    }
    return success;
  }

  public loadHouseholdMembers(householdId: string): Promise<void> {
    return this.householdService.loadHouseholdMembers(householdId);
  }

  public loadHouseholdInvitations(householdId: string): Promise<void> {
    return this.householdService.loadHouseholdInvitations(householdId);
  }

  public createInviteLink(
    householdId: string,
    role: HouseholdMemberRole = 'member',
    email?: string,
    validDays: number = 7
  ): Promise<HouseholdInvitation> {
    return this.householdService.createInviteLink(householdId, role, email, validDays);
  }

  public revokeInvite(invitationId: string): Promise<void> {
    return this.householdService.revokeInvite(invitationId);
  }

  public removeMember(householdId: string, userId: string): Promise<void> {
    return this.householdService.removeMember(householdId, userId);
  }

  public acceptInviteCode(code: string): Promise<{ success: boolean; message: string; household_id?: string; household_name?: string }> {
    return this.householdService.acceptInviteCode(code);
  }

  // State Mutations with Optimistic Updates
  public async adjustHeadcount(
    scheduleDate: string,
    mealType: MealType,
    delta: number,
    householdId?: string
  ): Promise<void> {
    const effectiveHhId = householdId || this.effectiveHouseholdId() || this.authorizedHouseholds()[0]?.id || DEFAULT_HOUSEHOLD.id;

    this.lumberjack.logInfo('Adjusting meal headcount', { scheduleDate, mealType, delta, householdId: effectiveHhId }, 'MealStoreService');
    if (!this.householdService.canPlanMeals(effectiveHhId)) {
      this.lumberjack.logWarning('Unauthorized headcount adjustment attempt', { householdId: effectiveHhId }, 'MealStoreService');
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
          this.lumberjack.logInfo('Headcount persisted in Supabase via RPC', { newCount }, 'MealStoreService');
        } catch (err: any) {
          this.lumberjack.logError('Failed to persist headcount via RPC, rolling back optimistic state', { error: err?.message || String(err) }, 'MealStoreService');
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

    this.lumberjack.logInfo('Scheduling meal', { schedule_date, meal_type, dish_id, targetHhId, headcount }, 'MealStoreService');
    if (!this.householdService.canPlanMeals(targetHhId)) {
      this.lumberjack.logWarning('Unauthorized meal planning attempt', { targetHhId }, 'MealStoreService');
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
      this.lumberjack.logInfo('Meal schedule updated in local state', { schedule_date, meal_type }, 'MealStoreService');
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
      this.lumberjack.logInfo('Meal schedule saved in Supabase', { id: saved.id, schedule_date, meal_type }, 'MealStoreService');
      this.showNotification(`Meal scheduled for ${meal_type} (${targetHh?.name || 'Household'}) on ${schedule_date}`, 'success');
    } catch (err: any) {
      this.lumberjack.logError('Error saving meal schedule in Supabase', { error: err?.message || String(err) }, 'MealStoreService');
      this.showNotification(`Error saving schedule: ${err.message}`, 'error');
    }
  }

  public async updateInventoryQuantity(ingredientId: string, newQuantity: number, minThreshold?: number): Promise<void> {
    this.lumberjack.logInfo('Updating inventory quantity', { ingredientId, newQuantity, minThreshold }, 'MealStoreService');
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
          this.lumberjack.logError('Error updating inventory in Supabase, rolling back optimistic update', { error: err?.message || String(err), ingredientId }, 'MealStoreService');
          this.showNotification(`Error updating inventory: ${err.message}`, 'error');
          this.inventory.set(current);
        }
      }
    }
  }

  public async adjustInventoryDelta(ingredientId: string, delta: number): Promise<void> {
    this.lumberjack.logInfo('Adjusting inventory delta', { ingredientId, delta }, 'MealStoreService');
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
    this.lumberjack.logInfo('Creating new ingredient', { name, category, unit, initialStock, minThreshold }, 'MealStoreService');
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
      this.lumberjack.logInfo('Ingredient created in local state', { id: newId, name }, 'MealStoreService');
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
      this.lumberjack.logInfo('Ingredient created in Supabase', { id: created.id, name: created.name }, 'MealStoreService');
      this.showNotification(`Added ingredient: ${name}`, 'success');
    } catch (err: any) {
      this.lumberjack.logError('Failed to create ingredient in Supabase', { error: err?.message || String(err) }, 'MealStoreService');
      this.showNotification(`Failed to create ingredient: ${err.message}`, 'error');
    }
  }

  public async createDish(
    name: string,
    cookNotes: string,
    recipeIngredients: { ingredient_id: string; qty_per_person: number }[]
  ): Promise<void> {
    this.lumberjack.logInfo('Creating new dish', { name, ingredientsCount: recipeIngredients.length }, 'MealStoreService');
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
      this.lumberjack.logInfo('Dish created in local state', { dishId, name }, 'MealStoreService');
      this.showNotification(`Created dish: ${name}`, 'success');
      return;
    }

    try {
      await this.supabase.createDish({ name, cook_notes: cookNotes }, recipeIngredients);
      const dishes = await this.supabase.fetchDishes();
      this.dishes.set(dishes);
      this.lumberjack.logInfo('Dish created in Supabase', { name }, 'MealStoreService');
      this.showNotification(`Created dish: ${name}`, 'success');
    } catch (err: any) {
      this.lumberjack.logError('Failed to create dish in Supabase', { error: err?.message || String(err) }, 'MealStoreService');
      this.showNotification(`Failed to create dish: ${err.message}`, 'error');
    }
  }

  public async deleteDish(dishId: string): Promise<void> {
    this.lumberjack.logInfo('Deleting dish', { dishId }, 'MealStoreService');
    if (!this.supabase.hasClient) {
      this.dishes.set(this.dishes().filter(d => d.id !== dishId));
      this.lumberjack.logInfo('Dish deleted locally', { dishId }, 'MealStoreService');
      this.showNotification('Dish removed', 'info');
      return;
    }

    try {
      await this.supabase.deleteDish(dishId);
      this.dishes.set(this.dishes().filter(d => d.id !== dishId));
      this.lumberjack.logInfo('Dish deleted in Supabase', { dishId }, 'MealStoreService');
      this.showNotification('Dish removed', 'info');
    } catch (err: any) {
      this.lumberjack.logError('Failed to delete dish in Supabase', { error: err?.message || String(err), dishId }, 'MealStoreService');
      this.showNotification(`Failed to delete dish: ${err.message}`, 'error');
    }
  }

  public async quickRestockAll(shortages: ShortageReportItem[]): Promise<void> {
    this.lumberjack.logInfo(`Quick restocking ${shortages.length} shortage items`, undefined, 'MealStoreService');
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
    this.notifications.show(message, type);
  }
}
