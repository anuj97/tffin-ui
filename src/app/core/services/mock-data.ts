import { Ingredient } from '../models/ingredient.model';
import { InventoryItem } from '../models/inventory.model';
import { Dish } from '../models/dish.model';
import { MealSchedule } from '../models/meal-schedule.model';

export const INITIAL_INGREDIENTS: Ingredient[] = [
  { id: 'ing-1', name: 'Paneer', category: 'dairy', unit: 'g' },
  { id: 'ing-2', name: 'Onions', category: 'produce', unit: 'g' },
  { id: 'ing-3', name: 'Tomatoes', category: 'produce', unit: 'g' },
  { id: 'ing-4', name: 'Ginger-Garlic Paste', category: 'spices', unit: 'g' },
  { id: 'ing-5', name: 'Garam Masala', category: 'spices', unit: 'g' },
  { id: 'ing-6', name: 'Basmati Rice', category: 'staples', unit: 'g' },
  { id: 'ing-7', name: 'Toor Dal', category: 'staples', unit: 'g' },
  { id: 'ing-8', name: 'Potatoes', category: 'produce', unit: 'g' },
  { id: 'ing-9', name: 'Cauliflower', category: 'produce', unit: 'g' },
  { id: 'ing-10', name: 'Mustard Seeds', category: 'spices', unit: 'g' },
  { id: 'ing-11', name: 'Poha (Flattened Rice)', category: 'staples', unit: 'g' },
  { id: 'ing-12', name: 'Green Chillies', category: 'produce', unit: 'pcs' },
  { id: 'ing-13', name: 'Cooking Oil', category: 'staples', unit: 'ml' },
  { id: 'ing-14', name: 'Rolled Oats', category: 'staples', unit: 'g' },
  { id: 'ing-15', name: 'Milk', category: 'dairy', unit: 'ml' },
  { id: 'ing-16', name: 'Eggs', category: 'dairy', unit: 'pcs' }
];

export const INITIAL_INVENTORY: InventoryItem[] = [
  { id: 'inv-1', ingredient_id: 'ing-1', quantity: 350, min_threshold: 400, updated_at: new Date().toISOString() }, // Low
  { id: 'inv-2', ingredient_id: 'ing-2', quantity: 2500, min_threshold: 1000, updated_at: new Date().toISOString() },
  { id: 'inv-3', ingredient_id: 'ing-3', quantity: 1800, min_threshold: 1000, updated_at: new Date().toISOString() },
  { id: 'inv-4', ingredient_id: 'ing-4', quantity: 80, min_threshold: 100, updated_at: new Date().toISOString() }, // Low
  { id: 'inv-5', ingredient_id: 'ing-5', quantity: 150, min_threshold: 50, updated_at: new Date().toISOString() },
  { id: 'inv-6', ingredient_id: 'ing-6', quantity: 4000, min_threshold: 2000, updated_at: new Date().toISOString() },
  { id: 'inv-7', ingredient_id: 'ing-7', quantity: 1200, min_threshold: 1000, updated_at: new Date().toISOString() },
  { id: 'inv-8', ingredient_id: 'ing-8', quantity: 2000, min_threshold: 1500, updated_at: new Date().toISOString() },
  { id: 'inv-9', ingredient_id: 'ing-9', quantity: 600, min_threshold: 500, updated_at: new Date().toISOString() },
  { id: 'inv-10', ingredient_id: 'ing-10', quantity: 120, min_threshold: 50, updated_at: new Date().toISOString() },
  { id: 'inv-11', ingredient_id: 'ing-11', quantity: 300, min_threshold: 500, updated_at: new Date().toISOString() }, // Low
  { id: 'inv-12', ingredient_id: 'ing-12', quantity: 25, min_threshold: 15, updated_at: new Date().toISOString() },
  { id: 'inv-13', ingredient_id: 'ing-13', quantity: 1500, min_threshold: 1000, updated_at: new Date().toISOString() },
  { id: 'inv-14', ingredient_id: 'ing-14', quantity: 800, min_threshold: 500, updated_at: new Date().toISOString() },
  { id: 'inv-15', ingredient_id: 'ing-15', quantity: 1000, min_threshold: 1500, updated_at: new Date().toISOString() }, // Low
  { id: 'inv-16', ingredient_id: 'ing-16', quantity: 12, min_threshold: 6, updated_at: new Date().toISOString() }
];

export const INITIAL_DISHES: Dish[] = [
  {
    id: 'dish-1',
    name: 'Paneer Butter Masala',
    cook_notes: 'Shallow fry paneer cubes lightly. Simmer cashew-tomato gravy on low flame for 10 mins before adding kasuri methi.',
    recipe_ingredients: [
      { ingredient_id: 'ing-1', qty_per_person: 100 }, // 100g paneer / person
      { ingredient_id: 'ing-2', qty_per_person: 60 },  // 60g onion
      { ingredient_id: 'ing-3', qty_per_person: 80 },  // 80g tomato
      { ingredient_id: 'ing-4', qty_per_person: 15 },  // 15g ginger garlic
      { ingredient_id: 'ing-5', qty_per_person: 5 },   // 5g garam masala
      { ingredient_id: 'ing-13', qty_per_person: 20 }  // 20ml oil/butter
    ]
  },
  {
    id: 'dish-2',
    name: 'Dal Tadka with Jeera Rice',
    cook_notes: 'Pressure cook dal with turmeric. Prepare tadka with ghee, cumin seeds, garlic, and dried red chilli.',
    recipe_ingredients: [
      { ingredient_id: 'ing-7', qty_per_person: 60 },
      { ingredient_id: 'ing-6', qty_per_person: 80 },
      { ingredient_id: 'ing-2', qty_per_person: 30 },
      { ingredient_id: 'ing-3', qty_per_person: 30 },
      { ingredient_id: 'ing-10', qty_per_person: 5 },
      { ingredient_id: 'ing-13', qty_per_person: 15 }
    ]
  },
  {
    id: 'dish-3',
    name: 'Aloo Gobi Matar',
    cook_notes: 'Parboil cauliflower florets. Cook aloo till golden before folding in dry spices.',
    recipe_ingredients: [
      { ingredient_id: 'ing-8', qty_per_person: 90 },
      { ingredient_id: 'ing-9', qty_per_person: 100 },
      { ingredient_id: 'ing-2', qty_per_person: 40 },
      { ingredient_id: 'ing-3', qty_per_person: 40 },
      { ingredient_id: 'ing-5', qty_per_person: 4 },
      { ingredient_id: 'ing-13', qty_per_person: 15 }
    ]
  },
  {
    id: 'dish-4',
    name: 'Homestyle Kanda Poha',
    cook_notes: 'Rinse poha gently and drain immediately. Temper with mustard seeds, curry leaves, and green chillies.',
    recipe_ingredients: [
      { ingredient_id: 'ing-11', qty_per_person: 70 },
      { ingredient_id: 'ing-2', qty_per_person: 40 },
      { ingredient_id: 'ing-12', qty_per_person: 1 },
      { ingredient_id: 'ing-10', qty_per_person: 3 },
      { ingredient_id: 'ing-13', qty_per_person: 10 }
    ]
  },
  {
    id: 'dish-5',
    name: 'Masala Oats & Boiled Eggs',
    cook_notes: 'Quick morning breakfast. Toast oats lightly, add finely diced tomatoes and onions. Serve with 2 soft-boiled eggs.',
    recipe_ingredients: [
      { ingredient_id: 'ing-14', qty_per_person: 60 },
      { ingredient_id: 'ing-16', qty_per_person: 2 },
      { ingredient_id: 'ing-2', qty_per_person: 25 },
      { ingredient_id: 'ing-3', qty_per_person: 25 },
      { ingredient_id: 'ing-12', qty_per_person: 1 }
    ]
  }
];

function getFormattedDate(offsetDays: number = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

export function generateInitialSchedule(): MealSchedule[] {
  return [
    // Today
    {
      id: 'sched-1',
      schedule_date: getFormattedDate(0),
      meal_type: 'breakfast',
      dish_id: 'dish-4', // Poha
      headcount: 3
    },
    {
      id: 'sched-2',
      schedule_date: getFormattedDate(0),
      meal_type: 'lunch',
      dish_id: 'dish-2', // Dal Tadka
      headcount: 4
    },
    {
      id: 'sched-3',
      schedule_date: getFormattedDate(0),
      meal_type: 'dinner',
      dish_id: 'dish-1', // Paneer Butter Masala
      headcount: 3
    },
    // Tomorrow
    {
      id: 'sched-4',
      schedule_date: getFormattedDate(1),
      meal_type: 'breakfast',
      dish_id: 'dish-5', // Oats & Eggs
      headcount: 3
    },
    {
      id: 'sched-5',
      schedule_date: getFormattedDate(1),
      meal_type: 'lunch',
      dish_id: 'dish-3', // Aloo Gobi
      headcount: 3
    },
    {
      id: 'sched-6',
      schedule_date: getFormattedDate(1),
      meal_type: 'dinner',
      dish_id: 'dish-2', // Dal Tadka
      headcount: 4
    },
    // Day +2
    {
      id: 'sched-7',
      schedule_date: getFormattedDate(2),
      meal_type: 'breakfast',
      dish_id: 'dish-4',
      headcount: 3
    },
    {
      id: 'sched-8',
      schedule_date: getFormattedDate(2),
      meal_type: 'lunch',
      dish_id: 'dish-1',
      headcount: 4
    },
    {
      id: 'sched-9',
      schedule_date: getFormattedDate(2),
      meal_type: 'dinner',
      dish_id: 'dish-3',
      headcount: 3
    }
  ];
}
