import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideLumberjack } from '@ngworker/lumberjack';
import { MealStoreService, DEFAULT_HOUSEHOLD } from './meal-store.service';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { Dish } from '../models/dish.model';
import { Ingredient } from '../models/ingredient.model';
import { InventoryItem } from '../models/inventory.model';
import { MealSchedule } from '../models/meal-schedule.model';
import { AppUser } from '../models/user.model';
import {
  MOCK_HOUSEHOLDS,
  MOCK_HOUSEHOLD_MEMBERS,
  MOCK_INGREDIENTS,
  MOCK_INVENTORY,
  MOCK_DISHES,
  generateMockSchedules
} from '../mock/mock-data';

describe('MealStoreService (Multi-Household & Authorization)', () => {
  let service: MealStoreService;
  let currentUserSignal = signal<AppUser | null>({
    id: 'admin-id',
    username: 'admin',
    role: 'admin',
    fullName: 'Kitchen Super Admin',
    household_ids: []
  });

  const mockAuthService = {
    currentUser: currentUserSignal,
    isAuthenticated: () => true
  };

  beforeEach(() => {
    currentUserSignal.set({
      id: 'admin-id',
      username: 'admin',
      role: 'admin',
      fullName: 'Kitchen Super Admin',
      household_ids: []
    });

    TestBed.configureTestingModule({
      providers: [
        provideLumberjack(),
        MealStoreService,
        { provide: AuthService, useValue: mockAuthService },
        {
          provide: SupabaseService,
          useValue: {
            hasClient: false,
            fetchHouseholds: async () => [],
            fetchIngredients: async () => [],
            fetchInventory: async () => [],
            fetchDishes: async () => [],
            fetchMealSchedule: async () => []
          }
        }
      ]
    });
    service = TestBed.inject(MealStoreService);
    service.householdService.households.set([...MOCK_HOUSEHOLDS]);
    service.householdService.householdMembers.set([...MOCK_HOUSEHOLD_MEMBERS]);
    service.ingredients.set([...MOCK_INGREDIENTS]);
    service.inventory.set([...MOCK_INVENTORY]);
    service.dishes.set([...MOCK_DISHES]);
    service.schedules.set(generateMockSchedules());
  });

  it('should initialize and support test fixture population', () => {
    expect(service.households().length).toBeGreaterThan(0);
    expect(service.households()[0].name).toBe('Main Household');
    expect(service.selectedHouseholdId()).toBeNull(); // defaults to All Households
    expect(service.ingredients().length).toBeGreaterThan(0);
    expect(service.dishes().length).toBeGreaterThan(0);
    expect(service.schedules().length).toBeGreaterThan(0);
  });

  it('should allow admin to create a new household in local state', async () => {
    const newHh = await service.createHousehold({
      name: 'Sharma Residence',
      code: 'HH-05',
      default_headcount: 4,
      dietary_notes: 'Jain',
      color_tag: '#10b981'
    });

    expect(newHh).toBeTruthy();
    expect(service.households().some(h => h.name === 'Sharma Residence')).toBeTrue();
  });

  it('should compute combined and filtered shortages across multiple households for admin', () => {
    const testIngredient: Ingredient = {
      id: 'ing-paneer',
      name: 'Paneer',
      category: 'dairy',
      unit: 'g'
    };

    const testDish: Dish = {
      id: 'dish-paneer-butter',
      name: 'Paneer Butter Masala',
      recipe_ingredients: [
        {
          id: 'ri-1',
          dish_id: 'dish-paneer-butter',
          ingredient_id: 'ing-paneer',
          qty_per_person: 100
        }
      ]
    };

    const testInventory: InventoryItem = {
      id: 'inv-1',
      ingredient_id: 'ing-paneer',
      quantity: 300, // 300g on hand
      min_threshold: 100,
      updated_at: new Date().toISOString()
    };

    const todayStr = new Date().toISOString().split('T')[0];

    // Household 1 (mock-hh-01) needs 3 portions = 300g
    const scheduleHH1: MealSchedule = {
      id: 'sched-1',
      household_id: 'mock-hh-01',
      schedule_date: todayStr,
      meal_type: 'lunch',
      dish_id: 'dish-paneer-butter',
      headcount: 3
    };

    // Household 2 (mock-hh-02) needs 2 portions = 200g
    const scheduleHH2: MealSchedule = {
      id: 'sched-2',
      household_id: 'mock-hh-02',
      schedule_date: todayStr,
      meal_type: 'lunch',
      dish_id: 'dish-paneer-butter',
      headcount: 2
    };

    service.ingredients.set([testIngredient]);
    service.inventory.set([testInventory]);
    service.dishes.set([testDish]);
    service.schedules.set([scheduleHH1, scheduleHH2]);

    // Combined requirement for admin: 5 portions * 100g = 500g needed. On hand = 300g. Deficit = 200g.
    const allShortages = service.calculateShortages(1, null);
    expect(allShortages.length).toBe(1);
    expect(allShortages[0].deficit).toBe(200);

    // Filtered to HH1 only: 3 portions * 100g = 300g needed. On hand = 300g. Deficit = 0.
    const hh1Shortages = service.calculateShortages(1, 'mock-hh-01');
    expect(hh1Shortages.length).toBe(0);

    // Filtered to HH2 only: 2 portions * 100g = 200g needed. On hand = 300g. Deficit = 0.
    const hh2Shortages = service.calculateShortages(1, 'mock-hh-02');
    expect(hh2Shortages.length).toBe(0);
  });

  describe('Household Isolation & Authorization', () => {
    it('should strictly isolate authorizedHouseholds to member assigned household', () => {
      // Simulate login as Amit Verma (assigned only to mock-hh-02)
      currentUserSignal.set({
        id: 'user-verma',
        username: 'amit_verma',
        fullName: 'Amit Verma',
        role: 'household_member',
        household_id: 'mock-hh-02',
        household_ids: ['mock-hh-02']
      });

      const authHouseholds = service.authorizedHouseholds();
      expect(authHouseholds.length).toBe(1);
      expect(authHouseholds[0].id).toBe('mock-hh-02');
      expect(authHouseholds[0].name).toBe('Verma Residence');
      expect(service.effectiveHouseholdId()).toBe('mock-hh-02');
    });

    it('should exclude other households schedules from getMealsForDate for single-household member', () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const scheduleHH1: MealSchedule = {
        id: 's-hh1',
        household_id: 'mock-hh-01',
        schedule_date: todayStr,
        meal_type: 'lunch',
        dish_id: 'dish-1',
        headcount: 3
      };
      const scheduleHH2: MealSchedule = {
        id: 's-hh2',
        household_id: 'mock-hh-02',
        schedule_date: todayStr,
        meal_type: 'lunch',
        dish_id: 'dish-2',
        headcount: 4
      };

      service.schedules.set([scheduleHH1, scheduleHH2]);

      // Switch to Verma user
      currentUserSignal.set({
        id: 'user-verma',
        username: 'amit_verma',
        fullName: 'Amit Verma',
        role: 'household_member',
        household_ids: ['mock-hh-02']
      });

      const meals = service.getMealsForDate(todayStr);
      const lunchSlot = meals.find(m => m.mealType === 'lunch');

      expect(lunchSlot).toBeTruthy();
      // Should ONLY contain Verma Residence schedule, HH-01 must not leak!
      expect(lunchSlot?.householdPlans.length).toBe(1);
      expect(lunchSlot?.householdPlans[0].schedule.household_id).toBe('mock-hh-02');
      expect(lunchSlot?.totalHeadcount).toBe(4);
    });

    it('should exclude non-authorized household demands from shortage calculations', () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const testIngredient: Ingredient = {
        id: 'ing-atta',
        name: 'Whole Wheat Atta',
        category: 'staples',
        unit: 'g'
      };

      const testDish: Dish = {
        id: 'dish-roti',
        name: 'Phulka Roti',
        recipe_ingredients: [
          {
            id: 'ri-roti',
            dish_id: 'dish-roti',
            ingredient_id: 'ing-atta',
            qty_per_person: 60
          }
        ]
      };

      // 100g on hand
      const testInventory: InventoryItem = {
        id: 'inv-atta',
        ingredient_id: 'ing-atta',
        quantity: 100,
        min_threshold: 50,
        updated_at: new Date().toISOString()
      };

      // HH-01 has a big demand: 10 people = 600g (would cause deficit of 500g)
      const scheduleHH1: MealSchedule = {
        id: 's-hh1-dinner',
        household_id: 'mock-hh-01',
        schedule_date: todayStr,
        meal_type: 'dinner',
        dish_id: 'dish-roti',
        headcount: 10
      };

      // HH-02 has 1 person = 60g (no deficit because 100g on hand)
      const scheduleHH2: MealSchedule = {
        id: 's-hh2-dinner',
        household_id: 'mock-hh-02',
        schedule_date: todayStr,
        meal_type: 'dinner',
        dish_id: 'dish-roti',
        headcount: 1
      };

      service.ingredients.set([testIngredient]);
      service.inventory.set([testInventory]);
      service.dishes.set([testDish]);
      service.schedules.set([scheduleHH1, scheduleHH2]);

      // Verma user logged in
      currentUserSignal.set({
        id: 'user-verma',
        username: 'amit_verma',
        fullName: 'Amit Verma',
        role: 'household_member',
        household_ids: ['mock-hh-02']
      });

      // Deficit should be 0 because HH-01's 600g demand is NOT visible or calculated for HH-02!
      const shortages = service.calculateShortages(1, null);
      expect(shortages.length).toBe(0);
    });

    it('should reject headcount adjustments and meal scheduling for unauthorized households', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const initialSchedules: MealSchedule[] = [
        {
          id: 's-hh1',
          household_id: 'mock-hh-01',
          schedule_date: todayStr,
          meal_type: 'lunch',
          dish_id: 'dish-1',
          headcount: 3
        }
      ];
      service.schedules.set(initialSchedules);

      // Verma user logged in
      currentUserSignal.set({
        id: 'user-verma',
        username: 'amit_verma',
        fullName: 'Amit Verma',
        role: 'household_member',
        household_ids: ['mock-hh-02']
      });

      // Attempt to modify HH-01 headcount
      await service.adjustHeadcount(todayStr, 'lunch', 2, 'mock-hh-01');

      // Schedule for HH-01 must remain unchanged
      expect(service.schedules()[0].headcount).toBe(3);
      expect(service.notification()?.type).toBe('error');

      // Attempt to set meal for HH-01
      await service.setMealSchedule(todayStr, 'dinner', 'dish-1', 4, 'mock-hh-01');
      const dinnerSched = service.schedules().find(s => s.meal_type === 'dinner' && s.household_id === 'mock-hh-01');
      expect(dinnerSched).toBeUndefined();
    });

    it('should support multi-household membership (e.g. manager of two households)', () => {
      // Kiran belongs to both mock-hh-02 and mock-hh-03
      currentUserSignal.set({
        id: 'user-multi',
        username: 'kiran_manager',
        fullName: 'Kiran Manager',
        role: 'household_member',
        household_ids: ['mock-hh-02', 'mock-hh-03']
      });

      const authHouseholds = service.authorizedHouseholds();
      expect(authHouseholds.length).toBe(2);
      const authIds = authHouseholds.map(h => h.id);
      expect(authIds).toContain('mock-hh-02');
      expect(authIds).toContain('mock-hh-03');
      expect(authIds).not.toContain('mock-hh-01');
    });

    it('should allow admin to delete household and cascade remove associated data', async () => {
      // Create a test household
      const created = await service.createHousehold({
        name: 'Temporary Household',
        code: 'TEMP-01',
        default_headcount: 2
      });
      expect(created).toBeTruthy();
      const hhId = created!.id;

      // Add a schedule for it
      service.schedules.update(list => [
        ...list,
        {
          id: 'temp-sched-1',
          schedule_date: '2026-10-02',
          meal_type: 'lunch',
          dish_id: 'dish-1',
          headcount: 2,
          household_id: hhId
        }
      ]);

      service.selectedHouseholdId.set(hhId);

      const success = await service.deleteHousehold(hhId);
      expect(success).toBeTrue();
      expect(service.households().some(h => h.id === hhId)).toBeFalse();
      expect(service.schedules().some(s => s.household_id === hhId)).toBeFalse();
      expect(service.selectedHouseholdId()).toBeNull();
    });

    it('should reject household deletion by non-owner member', async () => {
      currentUserSignal.set({
        id: 'user-regular',
        username: 'regular_member',
        fullName: 'Regular Member',
        role: 'household_member',
        household_ids: ['mock-hh-02']
      });

      // Clear any owner membership
      service.householdMembers.set([
        {
          id: 'hm-reg',
          household_id: 'mock-hh-02',
          user_id: 'user-regular',
          role_in_household: 'member',
          username: 'regular_member'
        }
      ]);

      const success = await service.deleteHousehold('mock-hh-02');
      expect(success).toBeFalse();
      expect(service.households().some(h => h.id === 'mock-hh-02')).toBeTrue();
      expect(service.notification()?.type).toBe('error');
    });

    it('should allow a user who is not a part of any household to create a household and become its owner', async () => {
      currentUserSignal.set({
        id: 'user-unassigned',
        username: 'unassigned_user',
        fullName: 'Unassigned User',
        role: 'household_member',
        household_ids: [] as string[]
      });

      expect(service.authorizedHouseholds().length).toBe(0);

      const created = await service.createHousehold({
        name: 'New Family Residence',
        code: 'NEW-01',
        default_headcount: 3
      });

      expect(created).toBeTruthy();
      expect(service.households().some(h => h.id === created!.id)).toBeTrue();

      // Creator must be added as owner
      const member = service.householdMembers().find(
        m => m.household_id === created!.id && m.user_id === 'user-unassigned'
      );
      expect(member).toBeTruthy();
      expect(member?.role_in_household).toBe('owner');

      // User's authorized households now includes the new household
      expect(service.authorizedHouseholds().some(h => h.id === created!.id)).toBeTrue();
      expect(service.selectedHouseholdId()).toBe(created!.id);
    });
  });
});
