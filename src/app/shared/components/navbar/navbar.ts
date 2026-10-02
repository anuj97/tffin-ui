import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MealStoreService } from '../../../core/services/meal-store.service';
import { AuthService } from '../../../core/services/auth.service';
import { Household } from '../../../core/models/household.model';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss'
})
export class NavbarComponent {
  public store = inject(MealStoreService);
  public auth = inject(AuthService);

  public currentUser = this.auth.currentUser;
  public households = this.store.households;
  public activeHouseholds = this.store.activeHouseholds;
  public selectedHouseholdId = this.store.selectedHouseholdId;

  // Household Manager Modal State
  public isManageModalOpen = signal<boolean>(false);
  public isCreateFormVisible = signal<boolean>(false);
  public newName = signal<string>('');
  public newCode = signal<string>('');
  public newContactName = signal<string>('');
  public newHeadcount = signal<number>(2);
  public newDietaryNotes = signal<string>('');
  public newColorTag = signal<string>('#6366f1');

  public currentHouseholdName = computed(() => {
    const id = this.selectedHouseholdId();
    if (!id) return 'All Households';
    const found = this.store.householdsMap().get(id);
    return found ? found.name : 'All Households';
  });

  get lowStockCount(): number {
    return this.store.lowStockCount();
  }

  public onSelectHousehold(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.store.setSelectedHousehold(val ? val : null);
  }

  public openManageModal(): void {
    this.resetForm();
    this.isManageModalOpen.set(true);
  }

  public closeManageModal(): void {
    this.isManageModalOpen.set(false);
  }

  public resetForm(): void {
    this.newName.set('');
    this.newCode.set('');
    this.newContactName.set('');
    this.newHeadcount.set(2);
    this.newDietaryNotes.set('');
    this.newColorTag.set('#6366f1');
    this.isCreateFormVisible.set(false);
  }

  public async saveNewHousehold(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;

    await this.store.createHousehold({
      name,
      code: this.newCode().trim() || undefined,
      contact_name: this.newContactName().trim() || undefined,
      default_headcount: Number(this.newHeadcount()) || 2,
      dietary_notes: this.newDietaryNotes().trim() || undefined,
      color_tag: this.newColorTag() || '#6366f1',
      is_active: true
    });

    this.resetForm();
  }

  public async toggleActive(id: string): Promise<void> {
    await this.store.toggleHouseholdActive(id);
  }

  public onLogout(): void {
    this.auth.logout();
  }
}
