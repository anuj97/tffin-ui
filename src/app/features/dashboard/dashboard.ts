import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MealStoreService, getTodayString, DayMealSlot, SlotHouseholdPlan } from '../../core/services/meal-store.service';
import { Dish } from '../../core/models/dish.model';
import { MealType } from '../../core/models/meal-schedule.model';
import { Household } from '../../core/models/household.model';

export interface BatchPrepDish {
  dishId: string;
  dishName: string;
  totalPortions: number;
  householdNames: string[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class DashboardComponent {
  public store = inject(MealStoreService);

  public todayStr = signal<string>(getTodayString());
  public isAssignModalOpen = signal<boolean>(false);
  public selectedMealType = signal<MealType>('lunch');
  public selectedHouseholdId = signal<string>('');
  public selectedDishId = signal<string>('');
  public modalHeadcount = signal<number>(3);

  // Computeds
  public todayMeals = this.store.todayMeals;
  public dishes = this.store.dishes;
  public lowStockItems = this.store.lowStockItems;
  public activeHouseholds = this.store.activeHouseholds;
  public currentHouseholdFilter = this.store.selectedHouseholdId;

  public modalHousehold = computed(() => {
    return this.store.householdsMap().get(this.selectedHouseholdId()) || null;
  });

  public todayTotalHeadcount = computed(() => {
    return this.todayMeals().reduce((sum, item) => sum + (item.totalHeadcount || 0), 0);
  });

  public householdsServedCount = computed(() => {
    const hhSet = new Set<string>();
    for (const m of this.todayMeals()) {
      for (const p of m.householdPlans) {
        hhSet.add(p.schedule.household_id);
      }
    }
    return hhSet.size;
  });

  public batchPrepSummary = computed<BatchPrepDish[]>(() => {
    const map = new Map<string, { dishName: string; portions: number; households: Set<string> }>();

    for (const m of this.todayMeals()) {
      for (const p of m.householdPlans) {
        if (p.dish) {
          const existing = map.get(p.dish.id);
          const hhName = p.household?.name || 'Household';
          if (existing) {
            existing.portions += p.schedule.headcount;
            existing.households.add(hhName);
          } else {
            map.set(p.dish.id, {
              dishName: p.dish.name,
              portions: p.schedule.headcount,
              households: new Set([hhName])
            });
          }
        }
      }
    }

    const result: BatchPrepDish[] = [];
    map.forEach((val, key) => {
      result.push({
        dishId: key,
        dishName: val.dishName,
        totalPortions: val.portions,
        householdNames: Array.from(val.households)
      });
    });

    return result.sort((a, b) => b.totalPortions - a.totalPortions);
  });

  public formattedToday = computed(() => {
    const d = new Date();
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  });

  public getMealBadgeClass(type: MealType): string {
    switch (type) {
      case 'breakfast': return 'badge-amber';
      case 'lunch': return 'badge-emerald';
      case 'dinner': return 'badge-purple';
    }
  }

  public setFilter(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.store.setSelectedHousehold(val ? val : null);
  }

  public openAssignModal(
    mealType: MealType, 
    currentDishId?: string, 
    currentHeadcount?: number,
    currentHouseholdId?: string
  ): void {
    const targetHhId = this.store.resolveTargetHouseholdId(currentHouseholdId);
    const hh = this.store.householdsMap().get(targetHhId);

    this.selectedMealType.set(mealType);
    this.selectedHouseholdId.set(targetHhId);
    this.selectedDishId.set(currentDishId || (this.dishes()[0]?.id || ''));
    this.modalHeadcount.set(currentHeadcount !== undefined ? currentHeadcount : (hh?.default_headcount || 3));
    this.isAssignModalOpen.set(true);
  }

  public onModalHouseholdChange(householdId: string): void {
    this.selectedHouseholdId.set(householdId);
    const hh = this.store.householdsMap().get(householdId);
    if (hh) {
      this.modalHeadcount.set(hh.default_headcount || 2);
    }
  }

  public closeAssignModal(): void {
    this.isAssignModalOpen.set(false);
  }

  public async saveAssignment(): Promise<void> {
    if (!this.selectedDishId() || !this.selectedHouseholdId()) return;

    await this.store.setMealSchedule(
      this.todayStr(),
      this.selectedMealType(),
      this.selectedDishId(),
      this.modalHeadcount(),
      this.selectedHouseholdId()
    );
    this.closeAssignModal();
  }

  public async incrementHeadcount(mealType: MealType, householdId: string): Promise<void> {
    await this.store.adjustHeadcount(this.todayStr(), mealType, 1, householdId);
  }

  public async decrementHeadcount(mealType: MealType, householdId: string): Promise<void> {
    await this.store.adjustHeadcount(this.todayStr(), mealType, -1, householdId);
  }

  public async quickRestock(ingredientId: string, amount: number): Promise<void> {
    await this.store.adjustInventoryDelta(ingredientId, amount);
  }
}
