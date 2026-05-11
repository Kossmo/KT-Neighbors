import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Species } from '../../core/models/species.model';
import { SpeciesStore } from '../../core/services/species-store';
import { RadiusSliderComponent } from '../discovery/radius-slider/radius-slider.component';
import { SpeciesListComponent } from '../discovery/species-list/species-list.component';

const KINGDOM_COLORS: Record<string, { bg: string; border: string }> = {
  Animalia:  { bg: 'rgba(196,135,58,0.12)',  border: '#c4873a' },
  Plantae:   { bg: 'rgba(92,122,78,0.12)',   border: '#5c7a4e' },
  Fungi:     { bg: 'rgba(168,80,80,0.12)',   border: '#a85050' },
  Chromista: { bg: 'rgba(74,106,122,0.12)',  border: '#4a6a7a' },
  Protozoa:  { bg: 'rgba(160,128,112,0.12)', border: '#a08070' },
  Bacteria:  { bg: 'rgba(160,128,112,0.12)', border: '#a08070' },
  Archaea:   { bg: 'rgba(160,128,112,0.12)', border: '#a08070' },
};

const DEFAULT_KINGDOM_COLOR = { bg: 'rgba(58,47,36,0.08)', border: '#6b5744' };

@Component({
  selector: 'app-search',
  imports: [SpeciesListComponent, RadiusSliderComponent],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchComponent implements OnInit {
  readonly store = inject(SpeciesStore);
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  readonly availableKingdoms = computed(() => {
    const kingdoms = new Set<string>();
    for (const s of this.store.species()) {
      if (s.kingdom) kingdoms.add(s.kingdom);
    }
    return Array.from(kingdoms).sort();
  });

  readonly filteredSpecies = computed<Species[]>(() => {
    const selected = this.store.selectedKingdoms();
    const q = this.store.searchQuery().trim().toLowerCase();

    let list = this.store.species();

    if (selected.size > 0) {
      list = list.filter((s) => selected.has(s.kingdom));
    }

    if (q) {
      list = list.filter((s) =>
        s.scientificName.toLowerCase().includes(q) ||
        (s.vernacularName?.toLowerCase().includes(q) ?? false) ||
        (s.kingdom?.toLowerCase().includes(q)  ?? false) ||
        (s.phylum?.toLowerCase().includes(q)   ?? false) ||
        (s.class?.toLowerCase().includes(q)    ?? false) ||
        (s.order?.toLowerCase().includes(q)    ?? false) ||
        (s.family?.toLowerCase().includes(q)   ?? false) ||
        (s.genus?.toLowerCase().includes(q)    ?? false),
      );
    }

    return list;
  });

  readonly isFiltered = computed(
    () => this.store.selectedKingdoms().size > 0 || this.store.searchQuery().trim().length > 0,
  );

  ngOnInit(): void {
    if (!this.store.species().length) this.router.navigate(['/']);
  }

  goBack(): void { this.location.back(); }

  onSearch(event: Event): void {
    this.store.searchQuery.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void { this.store.searchQuery.set(''); }

  toggleKingdom(kingdom: string): void {
    this.store.selectedKingdoms.update((set) => {
      const next = new Set(set);
      next.has(kingdom) ? next.delete(kingdom) : next.add(kingdom);
      return next;
    });
  }

  isKingdomSelected(kingdom: string): boolean {
    return this.store.selectedKingdoms().has(kingdom);
  }

  kingdomColor(kingdom: string): { bg: string; border: string } {
    return KINGDOM_COLORS[kingdom] ?? DEFAULT_KINGDOM_COLOR;
  }

  goToSpeciesDetail(taxonKey: number): void {
    this.router.navigate(['/species', taxonKey]);
  }

  selectSpecies(taxonKey: number | null): void {
    this.store.selectSpecies(taxonKey);
    if (taxonKey !== null) this.location.back();
  }

  updateRadius(km: number): void {
    this.store.updateRadius(km);
  }
}
