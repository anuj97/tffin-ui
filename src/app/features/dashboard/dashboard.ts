import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MealStoreService, getTodayString } from '../../core/services/meal-store.service';
import { Dish } from '../../core/models/dish.model';
import { MealType } from '../../core/models/meal-schedule.model';

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
  public selectedDishId = signal<string>('');
  public modalHeadcount = signal<number>(3);

  // Computeds
  public todayMeals = this.store.todayMeals;
  public dishes = this.store.dishes;
  public lowStockItems = this.store.lowStockItems;

  public todayTotalHeadcount = computed(() => {
    return this.todayMeals().reduce((sum, item) => sum + (item.schedule?.headcount || 0), 0);
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

  public openAssignModal(mealType: MealType, currentDishId?: string, currentHeadcount?: number): void {
    this.selectedMealType.set(mealType);
    this.selectedDishId.set(currentDishId || (this.dishes()[0]?.id || ''));
    this.modalHeadcount.set(currentHeadcount || 3);
    this.isAssignModalOpen.set(true);
  }

  public closeAssignModal(): void {
    this.isAssignModalOpen.set(false);
  }

  public async saveAssignment(): Promise<void> {
    if (!this.selectedDishId()) return;
    await this.store.setMealSchedule(
      this.todayStr(),
      this.selectedMealType(),
      this.selectedDishId(),
      this.modalHeadcount()
    );
    this.closeAssignModal();
  }

  public async incrementHeadcount(mealType: MealType): Promise<void> {
    await this.store.adjustHeadcount(this.todayStr(), mealType, 1);
  }

  public async decrementHeadcount(mealType: MealType): Promise<void> {
    await this.store.adjustHeadcount(this.todayStr(), mealType, -1);
  }

  public async quickRestock(ingredientId: string, amount: number): Promise<void> {
    await this.store.adjustInventoryDelta(ingredientId, amount);
  }
}
