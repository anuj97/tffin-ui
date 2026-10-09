import { Component, computed, HostListener, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter } from 'rxjs/operators';
import { HouseholdService } from '../../../core/services/household.service';
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
  public householdService = inject(HouseholdService);
  public store = inject(MealStoreService);
  public auth = inject(AuthService);
  private router = inject(Router);

  // Drawer / Sidebar State
  public isSidebarOpen = signal<boolean>(false);

  constructor() {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.closeSidebar();
      });
  }

  public toggleSidebar(): void {
    this.isSidebarOpen.update(open => !open);
  }

  public openSidebar(): void {
    this.isSidebarOpen.set(true);
  }

  public closeSidebar(): void {
    this.isSidebarOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  public onEscape(): void {
    if (this.isSidebarOpen()) {
      this.closeSidebar();
    }
  }

  public currentUser = this.auth.currentUser;
  public households = this.householdService.households;
  public activeHouseholds = this.householdService.activeHouseholds;
  public authorizedHouseholds = this.householdService.authorizedHouseholds;
  public selectedHouseholdId = this.householdService.selectedHouseholdId;

  public isSingleHouseholdUser = this.householdService.isSingleHouseholdUser;
  public singleHousehold = this.householdService.singleHousehold;
  public canManageHouseholds = computed(() => this.householdService.canManageAnyHousehold());

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
    const found = this.householdService.householdsMap().get(id);
    return found ? found.name : 'All Households';
  });

  get lowStockCount(): number {
    return this.store.lowStockCount();
  }

  public onSelectHousehold(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.householdService.setSelectedHousehold(val ? val : null);
  }

  public openManageModal(): void {
    if (!this.canManageHouseholds()) {
      this.store.showNotification('Only administrators or household owners can manage households', 'error');
      return;
    }
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

    await this.householdService.createHousehold({
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
    await this.householdService.toggleHouseholdActive(id);
  }

  public async confirmDelete(id: string, name: string): Promise<void> {
    if (confirm(`Are you sure you want to permanently delete the household "${name}"?\nAll associated meal plans and invitations will be removed.`)) {
      await this.householdService.deleteHousehold(id);
    }
  }

  public onLogout(): void {
    this.auth.logout();
  }
}
