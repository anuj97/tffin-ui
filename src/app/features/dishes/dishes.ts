import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MealStoreService } from '../../core/services/meal-store.service';
import { Dish } from '../../core/models/dish.model';

interface RecipeIngredientRow {
  ingredient_id: string;
  qty_per_person: number;
}

@Component({
  selector: 'app-dishes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dishes.html',
  styleUrl: './dishes.scss'
})
export class DishesComponent {
  public store = inject(MealStoreService);

  public searchQuery = signal<string>('');
  public portionMultiplier = signal<number>(3); // 1, 3, 5 people portion preview

  // Modal State
  public isCreateModalOpen = signal<boolean>(false);
  public newDishName = signal<string>('');
  public newCookNotes = signal<string>('');
  public newIngredients = signal<RecipeIngredientRow[]>([]);

  public dishes = this.store.dishes;
  public masterIngredients = this.store.ingredients;
  public ingredientsMap = this.store.ingredientsMap;

  public filteredDishes = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.dishes();
    return this.dishes().filter(d => 
      d.name.toLowerCase().includes(q) ||
      (d.cook_notes && d.cook_notes.toLowerCase().includes(q))
    );
  });

  public openCreateModal(): void {
    this.newDishName.set('');
    this.newCookNotes.set('');
    const firstIng = this.masterIngredients()[0]?.id || '';
    this.newIngredients.set([
      { ingredient_id: firstIng, qty_per_person: 50 }
    ]);
    this.isCreateModalOpen.set(true);
  }

  public closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  public addIngredientRow(): void {
    const firstIng = this.masterIngredients()[0]?.id || '';
    this.newIngredients.update(rows => [
      ...rows,
      { ingredient_id: firstIng, qty_per_person: 50 }
    ]);
  }

  public removeIngredientRow(index: number): void {
    this.newIngredients.update(rows => rows.filter((_, i) => i !== index));
  }

  public async saveDish(): Promise<void> {
    const name = this.newDishName().trim();
    if (!name) return;

    const validIngredients = this.newIngredients().filter(
      r => r.ingredient_id && r.qty_per_person > 0
    );

    await this.store.createDish(name, this.newCookNotes(), validIngredients);
    this.closeCreateModal();
  }

  public async deleteDish(dishId: string): Promise<void> {
    if (confirm('Are you sure you want to remove this dish?')) {
      await this.store.deleteDish(dishId);
    }
  }

  public getIngredientUnit(id: string): string {
    return this.ingredientsMap().get(id)?.unit || 'g';
  }

  public getIngredientName(id: string): string {
    return this.ingredientsMap().get(id)?.name || 'Unknown';
  }
}
