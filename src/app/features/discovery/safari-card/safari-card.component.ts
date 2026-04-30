import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Species } from '../../../core/models/species.model';
import { SpeciesStore } from '../../../core/services/species-store';

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return Math.abs(hash >>> 0);
}

@Component({
  selector: 'app-safari-card',
  templateUrl: './safari-card.component.html',
  styleUrl: './safari-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SafariCardComponent implements OnInit {
  private readonly store  = inject(SpeciesStore);
  private readonly router = inject(Router);

  readonly species     = signal<Species | null>(null);
  readonly expanded    = signal(true);
  readonly photoFailed = signal(false);
  readonly visible     = computed(() => this.store.mapMode() === 'pins');

  ngOnInit(): void {
    const all = this.store.species();
    if (all.length) this.species.set(this.pickDaily(all));
  }

  toggle(): void { this.expanded.update(v => !v); }

  goToDetail(): void {
    const sp = this.species();
    if (sp) this.router.navigate(['/species', sp.taxonKey]);
  }

  onPhotoError(): void { this.photoFailed.set(true); }

  private pickDaily(species: Species[]): Species {
    const today = new Date().toISOString().slice(0, 10);
    const coords = this.store.coordinates();
    const latR = coords ? Math.round(coords.lat * 50) / 50 : 0;
    const lonR = coords ? Math.round(coords.lon * 50) / 50 : 0;
    const seed = `${today}:${latR}:${lonR}`;
    return species[djb2(seed) % species.length];
  }
}
