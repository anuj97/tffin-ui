import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard'
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard').then(m => m.DashboardComponent)
  },
  {
    path: 'planner',
    loadComponent: () =>
      import('./features/planner/planner').then(m => m.PlannerComponent)
  },
  {
    path: 'dishes',
    loadComponent: () =>
      import('./features/dishes/dishes').then(m => m.DishesComponent)
  },
  {
    path: 'inventory',
    loadComponent: () =>
      import('./features/inventory/inventory').then(m => m.InventoryComponent)
  },
  {
    path: 'grocery',
    loadComponent: () =>
      import('./features/grocery/grocery').then(m => m.GroceryComponent)
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
