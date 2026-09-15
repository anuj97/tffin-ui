import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MealStoreService } from '../../core/services/meal-store.service';
import { ShortageReportItem } from '../../core/models/meal-schedule.model';

@Component({
  selector: 'app-grocery',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './grocery.html',
  styleUrl: './grocery.scss'
})
export class GroceryComponent {
  public store = inject(MealStoreService);

  public daysHorizon = signal<number>(4);
  public checkedItems = signal<Set<string>>(new Set());

  public shortages = computed<ShortageReportItem[]>(() => {
    // Calling the reactive calculator on the store
    // Re-evaluates whenever schedule, dishes, or inventory change!
    const _schedules = this.store.schedules();
    const _inventory = this.store.inventory();
    const _dishes = this.store.dishes();
    return this.store.calculateShortages(this.daysHorizon());
  });

  public setHorizon(days: number): void {
    this.daysHorizon.set(days);
    this.checkedItems.set(new Set());
  }

  public toggleChecked(id: string): void {
    const next = new Set(this.checkedItems());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.checkedItems.set(next);
  }

  public isChecked(id: string): boolean {
    return this.checkedItems().has(id);
  }

  public async restockItem(item: ShortageReportItem): Promise<void> {
    // Add deficit + 20% cushion to inventory
    const cushion = Math.ceil(item.deficit * 1.2);
    await this.store.adjustInventoryDelta(item.ingredientId, cushion);
    this.store.showNotification(`Restocked ${cushion}${item.unit} of ${item.ingredientName}`, 'success');
  }

  public async restockAll(): Promise<void> {
    const list = this.shortages();
    if (list.length === 0) return;
    await this.store.quickRestockAll(list);
  }
}
