import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
} from '@angular/core';
import { Router } from '@angular/router';
import { Species } from '../../core/models/species.model';
import { SpeciesStore } from '../../core/services/species-store';
import { MapComponent } from './map/map.component';
import { RadiusSliderComponent } from './radius-slider/radius-slider.component';
import { SpeciesListComponent } from './species-list/species-list.component';

// Colors for kingdom filter chips — carnet de terrain palette
const KINGDOM_COLORS: Record<string, { bg: string; border: string }> = {
  Animalia: { bg: 'rgba(196,135,58,0.12)',  border: '#c4873a' },
  Plantae:  { bg: 'rgba(92,122,78,0.12)',   border: '#5c7a4e' },
  Fungi:    { bg: 'rgba(168,80,80,0.12)',   border: '#a85050' },
  Chromista:{ bg: 'rgba(74,106,122,0.12)',  border: '#4a6a7a' },
  Protozoa: { bg: 'rgba(160,128,112,0.12)', border: '#a08070' },
  Bacteria: { bg: 'rgba(160,128,112,0.12)', border: '#a08070' },
  Archaea:  { bg: 'rgba(160,128,112,0.12)', border: '#a08070' },
};

const DEFAULT_KINGDOM_COLOR = { bg: 'rgba(58,47,36,0.08)', border: '#6b5744' };

@Component({
  selector: 'app-discovery',
  imports: [SpeciesListComponent, MapComponent, RadiusSliderComponent],
  templateUrl: './discovery.component.html',
  styleUrl: './discovery.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryComponent implements OnInit {
  readonly lat = input<string>('');
  readonly lon = input<string>('');

  readonly store = inject(SpeciesStore);
  private readonly router = inject(Router);

  // ─── Filters (state lives in store to survive detail navigation) ─────────
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

    if (this.mapMode() === 'heatmap') {
      const slot = this.heatSlots()[this.heatMonth()];
      if (slot) {
        list = list.filter((s) =>
          s.observations.some((o) => o.month === slot.month && o.year === slot.year),
        );
      }
    }

    return list;
  });

  readonly isFiltered = computed(
    () => this.store.selectedKingdoms().size > 0 || this.store.searchQuery().trim().length > 0,
  );

  // ─── Map mode ─────────────────────────────────────────────────────────────
  readonly mapMode   = this.store.mapMode;
  readonly heatMonth = this.store.heatMonth;

  // 12 rolling month slots ending at the current month
  readonly heatSlots = computed(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 12 + i, 1);
      const short = d.toLocaleString('en-US', { month: 'short' });
      return {
        month: d.getMonth() + 1,
        year:  d.getFullYear(),
        label: `${short} '${String(d.getFullYear()).slice(2)}`,
        short,
      };
    });
  });

  readonly monthlyHeatData = computed<{ lat: number; lon: number }[][]>(() => {
    const slots = this.heatSlots();
    return slots.map(slot =>
      this.store.species().flatMap(sp =>
        sp.observations
          .filter(o => o.month === slot.month && o.year === slot.year)
          .map(o => ({ lat: o.lat, lon: o.lon })),
      ),
    );
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────────
  ngOnInit(): void {
    const lat = parseFloat(this.lat());
    const lon = parseFloat(this.lon());

    if (isNaN(lat) || isNaN(lon)) {
      this.router.navigate(['/']);
      return;
    }

    const coords = this.store.coordinates();
    if (!coords || coords.lat !== lat || coords.lon !== lon) {
      this.store.search(lat, lon, this.store.radiusKm());
    }

    // Filters are reset inside store.search() when coords change
  }

  // ─── Actions ──────────────────────────────────────────────────────────────
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

  onSearch(event: Event): void {
    this.store.searchQuery.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.store.searchQuery.set('');
  }

  toggleMapMode(): void {
    this.store.mapMode.update(m => m === 'pins' ? 'heatmap' : 'pins');
  }

  onMonthChanged(month: number): void {
    this.store.heatMonth.set(month);
  }

  selectSpecies(taxonKey: number | null): void {
    this.store.selectSpecies(taxonKey);
  }

  goToSpeciesDetail(taxonKey: number): void {
    this.router.navigate(['/species', taxonKey]);
  }

  updateRadius(km: number): void {
    this.store.updateRadius(km);
  }

  goToTree(): void {
    this.router.navigate(['/tree']);
  }

  goToGame(): void {
    this.router.navigate(['/game']);
  }

  goHome(): void {
    this.store.searchQuery.set('');
    this.store.selectedKingdoms.set(new Set());
    this.store.mapMode.set('pins');
    this.store.heatMonth.set(0);
    this.router.navigate(['/']);
  }
}
