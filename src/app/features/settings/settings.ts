import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { MealStoreService } from '../../core/services/meal-store.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss'
})
export class SettingsComponent {
  public supabase = inject(SupabaseService);
  public store = inject(MealStoreService);

  public url = signal<string>(this.supabase.config().url);
  public anonKey = signal<string>(this.supabase.config().anonKey);
  public isDemoMode = signal<boolean>(this.supabase.config().isDemoMode);

  public isTesting = signal<boolean>(false);
  public testResult = signal<{ success: boolean; message: string } | null>(null);

  public schemaSQL = `-- 1. Master tables
create table ingredients (
    id uuid primary key default gen_random_uuid(),
    name text unique not null,
    category text default 'produce', -- 'produce', 'dairy', 'spices', 'staples'
    unit text default 'g' -- 'g', 'kg', 'pcs', 'ml'
);

create table inventory (
    id uuid primary key default gen_random_uuid(),
    ingredient_id uuid references ingredients(id) on delete cascade unique,
    quantity numeric default 0,
    min_threshold numeric default 0,
    updated_at timestamptz default now()
);

create table dishes (
    id uuid primary key default gen_random_uuid(),
    name text unique not null,
    cook_notes text
);

-- 2. Many-to-Many Recipe Ingredients
create table recipe_ingredients (
    id uuid primary key default gen_random_uuid(),
    dish_id uuid references dishes(id) on delete cascade,
    ingredient_id uuid references ingredients(id) on delete cascade,
    qty_per_person numeric not null,
    unique(dish_id, ingredient_id)
);

-- 3. Daily Meal Schedule
create table meal_schedule (
    id uuid primary key default gen_random_uuid(),
    schedule_date date not null,
    meal_type text check (meal_type in ('lunch', 'dinner', 'breakfast')),
    dish_id uuid references dishes(id),
    headcount int default 3,
    unique(schedule_date, meal_type)
);

-- 4. Helper Stored Procedure: Update Headcount via Bot
create or replace function update_meal_headcount(p_date date, p_meal text, p_delta int)
returns int as $$
declare
    v_count int;
begin
    update meal_schedule
    set headcount = greatest(headcount + p_delta, 0)
    where schedule_date = p_date and meal_type = p_meal
    returning headcount into v_count;
    return v_count;
end;
$$ language plpgsql security definer;`;

  public async onSave(): Promise<void> {
    this.supabase.saveConfig({
      url: this.url().trim(),
      anonKey: this.anonKey().trim(),
      isDemoMode: this.isDemoMode()
    });

    await this.store.init();
    this.store.showNotification('Configuration saved successfully!', 'success');
  }

  public async onTest(): Promise<void> {
    this.isTesting.set(true);
    this.testResult.set(null);

    // Temporarily apply values to test
    this.supabase.saveConfig({
      url: this.url().trim(),
      anonKey: this.anonKey().trim(),
      isDemoMode: false
    });

    const res = await this.supabase.testConnection();
    this.isTesting.set(false);

    if (res.success) {
      this.testResult.set({
        success: true,
        message: 'Connected to Supabase PostgreSQL database successfully!'
      });
    } else {
      this.testResult.set({
        success: false,
        message: res.error || 'Connection failed. Please verify URL and Anon Key.'
      });
    }
  }

  public copySQL(): void {
    navigator.clipboard.writeText(this.schemaSQL);
    this.store.showNotification('SQL schema copied to clipboard!', 'info');
  }
}
