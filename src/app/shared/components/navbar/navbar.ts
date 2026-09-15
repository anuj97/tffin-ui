import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MealStoreService } from '../../../core/services/meal-store.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss'
})
export class NavbarComponent {
  public store = inject(MealStoreService);

  get lowStockCount(): number {
    return this.store.lowStockCount();
  }
}
