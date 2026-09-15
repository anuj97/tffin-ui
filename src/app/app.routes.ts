import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard'
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login').then(m => m.LoginComponent)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard').then(m => m.DashboardComponent)
  },
  {
    path: 'planner',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/planner/planner').then(m => m.PlannerComponent)
  },
  {
    path: 'dishes',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dishes/dishes').then(m => m.DishesComponent)
  },
  {
    path: 'inventory',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/inventory/inventory').then(m => m.InventoryComponent)
  },
  {
    path: 'grocery',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/grocery/grocery').then(m => m.GroceryComponent)
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
