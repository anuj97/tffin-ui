import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MealStoreService } from '../../core/services/meal-store.service';
import { IngredientCategory, MeasurementUnit } from '../../core/models/ingredient.model';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory.html',
  styleUrl: './inventory.scss'
})
export class InventoryComponent {
  public store = inject(MealStoreService);

  public selectedCategory = signal<string>('all');
  public searchQuery = signal<string>('');
  public filterLowStockOnly = signal<boolean>(false);

  // New Ingredient Modal
  public isModalOpen = signal<boolean>(false);
  public newName = signal<string>('');
  public newCategory = signal<IngredientCategory>('produce');
  public newUnit = signal<MeasurementUnit>('g');
  public newInitialStock = signal<number>(500);
  public newMinThreshold = signal<number>(250);

  public enrichedInventory = this.store.enrichedInventory;

  public categories = ['all', 'produce', 'dairy', 'spices', 'staples'];

  public filteredInventory = computed(() => {
    let list = this.enrichedInventory();
    const cat = this.selectedCategory();
    const query = this.searchQuery().toLowerCase().trim();
    const lowOnly = this.filterLowStockOnly();

    if (cat !== 'all') {
      list = list.filter(item => item.ingredient?.category?.toLowerCase() === cat.toLowerCase());
    }

    if (query) {
      list = list.filter(item => item.ingredient?.name.toLowerCase().includes(query));
    }

    if (lowOnly) {
      list = list.filter(item => item.isLowStock);
    }

    return list;
  });

  public openCreateModal(): void {
    this.newName.set('');
    this.newCategory.set('produce');
    this.newUnit.set('g');
    this.newInitialStock.set(500);
    this.newMinThreshold.set(250);
    this.isModalOpen.set(true);
  }

  public closeModal(): void {
    this.isModalOpen.set(false);
  }

  public async saveNewIngredient(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;

    await this.store.createIngredient(
      name,
      this.newCategory(),
      this.newUnit(),
      this.newInitialStock(),
      this.newMinThreshold()
    );
    this.closeModal();
  }

  public async adjustStock(ingredientId: string, delta: number): Promise<void> {
    await this.store.adjustInventoryDelta(ingredientId, delta);
  }

  public async onDirectQtyChange(ingredientId: string, event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const val = Number(target.value);
    if (!isNaN(val)) {
      await this.store.updateInventoryQuantity(ingredientId, val);
    }
  }

  public async onDirectThresholdChange(ingredientId: string, currentQty: number, event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const val = Number(target.value);
    if (!isNaN(val)) {
      await this.store.updateInventoryQuantity(ingredientId, currentQty, val);
    }
  }
}
