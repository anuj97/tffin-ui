import { TestBed } from '@angular/core/testing';
import { MealStoreService, DEFAULT_HOUSEHOLD } from './meal-store.service';
import { SupabaseService } from './supabase.service';
import { Dish } from '../models/dish.model';
import { Ingredient } from '../models/ingredient.model';
import { InventoryItem } from '../models/inventory.model';
import { MealSchedule } from '../models/meal-schedule.model';

describe('MealStoreService (Multi-Household)', () => {
  let service: MealStoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MealStoreService,
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
  });

  it('should initialize with default household', () => {
    expect(service.households().length).toBeGreaterThan(0);
    expect(service.households()[0].name).toBe(DEFAULT_HOUSEHOLD.name);
    expect(service.selectedHouseholdId()).toBeNull(); // defaults to All Households
  });

  it('should allow creating a new household in local state', async () => {
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

  it('should compute combined and filtered shortages across multiple households', () => {
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

    // Household 1 needs 3 portions = 300g
    const scheduleHH1: MealSchedule = {
      id: 'sched-1',
      household_id: 'hh-1',
      schedule_date: todayStr,
      meal_type: 'lunch',
      dish_id: 'dish-paneer-butter',
      headcount: 3
    };

    // Household 2 needs 2 portions = 200g
    const scheduleHH2: MealSchedule = {
      id: 'sched-2',
      household_id: 'hh-2',
      schedule_date: todayStr,
      meal_type: 'lunch',
      dish_id: 'dish-paneer-butter',
      headcount: 2
    };

    service.ingredients.set([testIngredient]);
    service.inventory.set([testInventory]);
    service.dishes.set([testDish]);
    service.schedules.set([scheduleHH1, scheduleHH2]);

    // Combined requirement: 5 portions * 100g = 500g needed. On hand = 300g. Deficit = 200g.
    const allShortages = service.calculateShortages(1, null);
    expect(allShortages.length).toBe(1);
    expect(allShortages[0].deficit).toBe(200);

    // Filtered to HH1 only: 3 portions * 100g = 300g needed. On hand = 300g. Deficit = 0.
    const hh1Shortages = service.calculateShortages(1, 'hh-1');
    expect(hh1Shortages.length).toBe(0);

    // Filtered to HH2 only: 2 portions * 100g = 200g needed. On hand = 300g. Deficit = 0.
    const hh2Shortages = service.calculateShortages(1, 'hh-2');
    expect(hh2Shortages.length).toBe(0);
  });

  it('should group meal plans by household for a slot', () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const schedule1: MealSchedule = {
      id: 's1',
      household_id: 'hh-1',
      schedule_date: todayStr,
      meal_type: 'lunch',
      dish_id: 'd1',
      headcount: 3
    };
    const schedule2: MealSchedule = {
      id: 's2',
      household_id: 'hh-2',
      schedule_date: todayStr,
      meal_type: 'lunch',
      dish_id: 'd2',
      headcount: 4
    };

    service.schedules.set([schedule1, schedule2]);

    const meals = service.getMealsForDate(todayStr, null);
    const lunchSlot = meals.find(m => m.mealType === 'lunch');

    expect(lunchSlot).toBeTruthy();
    expect(lunchSlot?.householdPlans.length).toBe(2);
    expect(lunchSlot?.totalHeadcount).toBe(7);
  });
});
