import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MealStoreService, getTodayString } from '../../core/services/meal-store.service';
import { Dish } from '../../core/models/dish.model';
import { MealSchedule, MealType } from '../../core/models/meal-schedule.model';

export interface DayColumn {
  dateStr: string;
  dayName: string;
  dayNumber: string;
  isToday: boolean;
  meals: {
    mealType: MealType;
    schedule: MealSchedule | null;
    dish: Dish | null;
    stockStatus: any;
  }[];
  totalDayHeadcount: number;
}

@Component({
  selector: 'app-planner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './planner.html',
  styleUrl: './planner.scss'
})
export class PlannerComponent {
  public store = inject(MealStoreService);

  public weekOffset = signal<number>(0);
  public isModalOpen = signal<boolean>(false);
  public modalDate = signal<string>('');
  public modalMealType = signal<MealType>('lunch');
  public modalDishId = signal<string>('');
  public modalHeadcount = signal<number>(3);

  public dishes = this.store.dishes;

  public weekDays = computed<DayColumn[]>(() => {
    const offset = this.weekOffset() * 7;
    const days: DayColumn[] = [];
    const today = getTodayString();

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + offset + i);
      const dateStr = d.toISOString().split('T')[0];

      const dayMeals = this.store.getMealsForDate(dateStr);
      const totalHeadcount = dayMeals.reduce((acc, m) => acc + (m.schedule?.headcount || 0), 0);

      days.push({
        dateStr,
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNumber: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        isToday: dateStr === today,
        meals: dayMeals,
        totalDayHeadcount: totalHeadcount
      });
    }

    return days;
  });

  public prevWeek(): void {
    this.weekOffset.update(w => w - 1);
  }

  public nextWeek(): void {
    this.weekOffset.update(w => w + 1);
  }

  public resetToToday(): void {
    this.weekOffset.set(0);
  }

  public openSlotModal(dateStr: string, mealType: MealType, currentDishId?: string, currentHeadcount?: number): void {
    this.modalDate.set(dateStr);
    this.modalMealType.set(mealType);
    this.modalDishId.set(currentDishId || (this.dishes()[0]?.id || ''));
    this.modalHeadcount.set(currentHeadcount || 3);
    this.isModalOpen.set(true);
  }

  public closeModal(): void {
    this.isModalOpen.set(false);
  }

  public async saveSchedule(): Promise<void> {
    if (!this.modalDishId()) return;
    await this.store.setMealSchedule(
      this.modalDate(),
      this.modalMealType(),
      this.modalDishId(),
      this.modalHeadcount()
    );
    this.closeModal();
  }

  public async adjustSlotHeadcount(dateStr: string, mealType: MealType, delta: number, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.store.adjustHeadcount(dateStr, mealType, delta);
  }
}
