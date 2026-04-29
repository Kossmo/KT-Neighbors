import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: 'discovery',
    loadComponent: () =>
      import('./features/discovery/discovery.component').then((m) => m.DiscoveryComponent),
  },
  {
    path: 'species/:taxonKey',
    loadComponent: () =>
      import('./features/species-detail/species-detail.component').then(
        (m) => m.SpeciesDetailComponent,
      ),
  },
  {
    path: 'tree',
    loadComponent: () =>
      import('./features/tree/tree.component').then((m) => m.TreeComponent),
  },
  { path: '**', redirectTo: '' },
];
