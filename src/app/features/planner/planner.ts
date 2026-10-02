import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MealStoreService, getTodayString, DayMealSlot, SlotHouseholdPlan } from '../../core/services/meal-store.service';
import { Dish } from '../../core/models/dish.model';
import { MealSchedule, MealType } from '../../core/models/meal-schedule.model';
import { Household } from '../../core/models/household.model';

export interface DayColumn {
  dateStr: string;
  dayName: string;
  dayNumber: string;
  isToday: boolean;
  meals: DayMealSlot[];
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
  public modalHouseholdId = signal<string>('');
  public modalDishId = signal<string>('');
  public modalHeadcount = signal<number>(3);

  public dishes = this.store.dishes;
  public activeHouseholds = this.store.activeHouseholds;
  public selectedHouseholdId = this.store.selectedHouseholdId;

  public modalHousehold = computed(() => {
    return this.store.householdsMap().get(this.modalHouseholdId()) || null;
  });

  public weekDays = computed<DayColumn[]>(() => {
    const offset = this.weekOffset() * 7;
    const days: DayColumn[] = [];
    const today = getTodayString();

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + offset + i);
      const dateStr = d.toISOString().split('T')[0];

      const dayMeals = this.store.getMealsForDate(dateStr);
      const totalHeadcount = dayMeals.reduce((acc, m) => acc + (m.totalHeadcount || 0), 0);

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

  public setPlannerHousehold(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.store.setSelectedHousehold(val ? val : null);
  }

  public openSlotModal(
    dateStr: string,
    mealType: MealType,
    currentDishId?: string,
    currentHeadcount?: number,
    currentHouseholdId?: string
  ): void {
    const targetHhId = currentHouseholdId || this.selectedHouseholdId() || this.activeHouseholds()[0]?.id || '';
    const hh = this.store.householdsMap().get(targetHhId);

    this.modalDate.set(dateStr);
    this.modalMealType.set(mealType);
    this.modalHouseholdId.set(targetHhId);
    this.modalDishId.set(currentDishId || (this.dishes()[0]?.id || ''));
    this.modalHeadcount.set(currentHeadcount !== undefined ? currentHeadcount : (hh?.default_headcount || 3));
    this.isModalOpen.set(true);
  }

  public onModalHouseholdChange(householdId: string): void {
    this.modalHouseholdId.set(householdId);
    const hh = this.store.householdsMap().get(householdId);
    if (hh) {
      this.modalHeadcount.set(hh.default_headcount || 2);
    }
  }

  public closeModal(): void {
    this.isModalOpen.set(false);
  }

  public async saveSchedule(): Promise<void> {
    if (!this.modalDishId() || !this.modalHouseholdId()) return;

    await this.store.setMealSchedule(
      this.modalDate(),
      this.modalMealType(),
      this.modalDishId(),
      this.modalHeadcount(),
      this.modalHouseholdId()
    );
    this.closeModal();
  }

  public async adjustSlotHeadcount(
    dateStr: string,
    mealType: MealType,
    delta: number,
    householdId: string,
    event: MouseEvent
  ): Promise<void> {
    event.stopPropagation();
    await this.store.adjustHeadcount(dateStr, mealType, delta, householdId);
  }
}
