import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MealStoreService } from '../../../core/services/meal-store.service';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss'
})
export class NavbarComponent {
  public store = inject(MealStoreService);
  public supabase = inject(SupabaseService);

  get isDemoMode(): boolean {
    return this.supabase.isDemo;
  }

  get isConnected(): boolean {
    return this.supabase.isConnected();
  }

  get lowStockCount(): number {
    return this.store.lowStockCount();
  }
}
