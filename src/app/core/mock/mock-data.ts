import { Household } from '../models/household.model';
import { Ingredient } from '../models/ingredient.model';
import { InventoryItem } from '../models/inventory.model';
import { Dish } from '../models/dish.model';
import { MealSchedule } from '../models/meal-schedule.model';

export const MOCK_HOUSEHOLDS: Household[] = [
  {
    id: 'mock-hh-01',
    name: 'Main Household',
    code: 'HH-01',
    contact_name: 'Aditi Sharma',
    contact_phone: '+91 98765 43210',
    address: 'B-104, Sunrise Heights',
    default_headcount: 3,
    dietary_notes: 'Standard diet, medium spice',
    color_tag: '#6366f1',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'mock-hh-02',
    name: 'Verma Residence',
    code: 'HH-02',
    contact_name: 'Amit Verma',
    contact_phone: '+91 98123 45678',
    address: 'Flat 402, Oakwood Towers',
    default_headcount: 4,
    dietary_notes: 'Pure Vegetarian, mild spice',
    color_tag: '#10b981',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'mock-hh-03',
    name: 'Apartment 301',
    code: 'HH-03',
    contact_name: 'Priya Patel',
    contact_phone: '+91 99887 76655',
    address: '301, Palm Grove Apartments',
    default_headcount: 2,
    dietary_notes: 'Jain (strictly no onion, no garlic)',
    color_tag: '#f59e0b',
    is_active: true,
    created_at: new Date().toISOString()
  }
];

export const MOCK_INGREDIENTS: Ingredient[] = [
  { id: 'ing-01', name: 'Paneer', category: 'dairy', unit: 'g' },
  { id: 'ing-02', name: 'Basmati Rice', category: 'staples', unit: 'g' },
  { id: 'ing-03', name: 'Toor Dal', category: 'staples', unit: 'g' },
  { id: 'ing-04', name: 'Onions', category: 'produce', unit: 'g' },
  { id: 'ing-05', name: 'Tomatoes', category: 'produce', unit: 'g' },
  { id: 'ing-06', name: 'Potatoes', category: 'produce', unit: 'g' },
  { id: 'ing-07', name: 'Ghee', category: 'dairy', unit: 'g' },
  { id: 'ing-08', name: 'Cumin Seeds', category: 'spices', unit: 'g' },
  { id: 'ing-09', name: 'Garam Masala', category: 'spices', unit: 'g' },
  { id: 'ing-10', name: 'Wheat Flour (Atta)', category: 'staples', unit: 'g' },
  { id: 'ing-11', name: 'Green Peas', category: 'produce', unit: 'g' }
];

export const MOCK_INVENTORY: InventoryItem[] = [
  { id: 'inv-01', ingredient_id: 'ing-01', quantity: 400, min_threshold: 500, updated_at: new Date().toISOString() }, // low
  { id: 'inv-02', ingredient_id: 'ing-02', quantity: 2500, min_threshold: 1000, updated_at: new Date().toISOString() },
  { id: 'inv-03', ingredient_id: 'ing-03', quantity: 300, min_threshold: 600, updated_at: new Date().toISOString() }, // low
  { id: 'inv-04', ingredient_id: 'ing-04', quantity: 1800, min_threshold: 800, updated_at: new Date().toISOString() },
  { id: 'inv-05', ingredient_id: 'ing-05', quantity: 700, min_threshold: 500, updated_at: new Date().toISOString() },
  { id: 'inv-06', ingredient_id: 'ing-06', quantity: 2000, min_threshold: 1000, updated_at: new Date().toISOString() },
  { id: 'inv-07', ingredient_id: 'ing-07', quantity: 450, min_threshold: 300, updated_at: new Date().toISOString() },
  { id: 'inv-08', ingredient_id: 'ing-08', quantity: 150, min_threshold: 100, updated_at: new Date().toISOString() },
  { id: 'inv-09', ingredient_id: 'ing-09', quantity: 80, min_threshold: 100, updated_at: new Date().toISOString() }, // low
  { id: 'inv-10', ingredient_id: 'ing-10', quantity: 4000, min_threshold: 2000, updated_at: new Date().toISOString() },
  { id: 'inv-11', ingredient_id: 'ing-11', quantity: 200, min_threshold: 300, updated_at: new Date().toISOString() } // low
];

export const MOCK_DISHES: Dish[] = [
  {
    id: 'dish-01',
    name: 'Dal Tadka & Jeera Rice',
    cook_notes: 'Cook dal with turmeric, temper with cumin, garlic and ghee.',
    recipe_ingredients: [
      { id: 'ri-01', dish_id: 'dish-01', ingredient_id: 'ing-03', qty_per_person: 60 },
      { id: 'ri-02', dish_id: 'dish-01', ingredient_id: 'ing-02', qty_per_person: 80 },
      { id: 'ri-03', dish_id: 'dish-01', ingredient_id: 'ing-07', qty_per_person: 10 },
      { id: 'ri-04', dish_id: 'dish-01', ingredient_id: 'ing-08', qty_per_person: 5 }
    ]
  },
  {
    id: 'dish-02',
    name: 'Paneer Butter Masala',
    cook_notes: 'Rich tomato cashew gravy. Use fresh paneer cubes.',
    recipe_ingredients: [
      { id: 'ri-05', dish_id: 'dish-02', ingredient_id: 'ing-01', qty_per_person: 100 },
      { id: 'ri-06', dish_id: 'dish-02', ingredient_id: 'ing-05', qty_per_person: 80 },
      { id: 'ri-07', dish_id: 'dish-02', ingredient_id: 'ing-07', qty_per_person: 15 },
      { id: 'ri-08', dish_id: 'dish-02', ingredient_id: 'ing-09', qty_per_person: 5 }
    ]
  },
  {
    id: 'dish-03',
    name: 'Aloo Matar with Roti',
    cook_notes: 'Comfort food homestyle potato and peas curry with soft rotis.',
    recipe_ingredients: [
      { id: 'ri-09', dish_id: 'dish-03', ingredient_id: 'ing-06', qty_per_person: 100 },
      { id: 'ri-10', dish_id: 'dish-03', ingredient_id: 'ing-11', qty_per_person: 50 },
      { id: 'ri-11', dish_id: 'dish-03', ingredient_id: 'ing-10', qty_per_person: 80 },
      { id: 'ri-12', dish_id: 'dish-03', ingredient_id: 'ing-05', qty_per_person: 50 }
    ]
  },
  {
    id: 'dish-04',
    name: 'Poha with Roasted Peanuts',
    cook_notes: 'Light breakfast tempered with mustard, curry leaves, and green chillies.',
    recipe_ingredients: [
      { id: 'ri-13', dish_id: 'dish-04', ingredient_id: 'ing-04', qty_per_person: 40 },
      { id: 'ri-14', dish_id: 'dish-04', ingredient_id: 'ing-06', qty_per_person: 40 }
    ]
  },
  {
    id: 'dish-05',
    name: 'Idli & Sambar',
    cook_notes: 'Steamed fermented rice cakes with vegetable lentil stew.',
    recipe_ingredients: [
      { id: 'ri-15', dish_id: 'dish-05', ingredient_id: 'ing-03', qty_per_person: 50 },
      { id: 'ri-16', dish_id: 'dish-05', ingredient_id: 'ing-05', qty_per_person: 40 }
    ]
  }
];

export function generateMockSchedules(): MealSchedule[] {
  const schedules: MealSchedule[] = [];
  const today = new Date();

  // Generate for days -2 to +5
  for (let offset = -2; offset <= 5; offset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    const dateStr = d.toISOString().split('T')[0];

    // Household 1 (Main Household)
    schedules.push({
      id: `sched-${dateStr}-hh1-b`,
      household_id: 'mock-hh-01',
      schedule_date: dateStr,
      meal_type: 'breakfast',
      dish_id: 'dish-04',
      headcount: 3
    });
    schedules.push({
      id: `sched-${dateStr}-hh1-l`,
      household_id: 'mock-hh-01',
      schedule_date: dateStr,
      meal_type: 'lunch',
      dish_id: 'dish-01',
      headcount: 3
    });
    schedules.push({
      id: `sched-${dateStr}-hh1-d`,
      household_id: 'mock-hh-01',
      schedule_date: dateStr,
      meal_type: 'dinner',
      dish_id: 'dish-02',
      headcount: 3
    });

    // Household 2 (Verma Residence)
    schedules.push({
      id: `sched-${dateStr}-hh2-l`,
      household_id: 'mock-hh-02',
      schedule_date: dateStr,
      meal_type: 'lunch',
      dish_id: 'dish-01',
      headcount: 4
    });
    schedules.push({
      id: `sched-${dateStr}-hh2-d`,
      household_id: 'mock-hh-02',
      schedule_date: dateStr,
      meal_type: 'dinner',
      dish_id: 'dish-03',
      headcount: 4
    });

    // Household 3 (Apartment 301 - Jain)
    schedules.push({
      id: `sched-${dateStr}-hh3-l`,
      household_id: 'mock-hh-03',
      schedule_date: dateStr,
      meal_type: 'lunch',
      dish_id: 'dish-02',
      headcount: 2
    });
  }

  return schedules;
}
