import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MealStoreService } from '../../../core/services/meal-store.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss'
})
export class NavbarComponent {
  public store = inject(MealStoreService);
  public auth = inject(AuthService);

  public currentUser = this.auth.currentUser;

  get lowStockCount(): number {
    return this.store.lowStockCount();
  }

  public onLogout(): void {
    this.auth.logout();
  }
}
