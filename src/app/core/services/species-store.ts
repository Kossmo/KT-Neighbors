import { computed, inject, Injectable, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { GbifService } from '../api/gbif.service';
import { GbifOccurrence } from '../models/occurrence.model';
import { Species } from '../models/species.model';
import { CacheService } from './cache.service';
import { aggregateOccurrences } from '../utils/species-aggregator';

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error' | 'empty';

@Injectable({ providedIn: 'root' })
export class SpeciesStore {
  private readonly gbif = inject(GbifService);
  private readonly cache = inject(CacheService);

  // ─── State signals ──────────────────────────────────────────────────────────
  readonly species = signal<Species[]>([]);
  readonly selectedTaxonKey = signal<number | null>(null);
  readonly status = signal<SearchStatus>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly coordinates = signal<{ lat: number; lon: number } | null>(null);
  readonly locationName = signal<string>('');
  readonly radiusKm = signal<number>(5);

  // ─── Filter + UI state (persisted across detail navigation, reset on new search) ─
  readonly searchQuery      = signal<string>('');
  readonly selectedKingdoms = signal<Set<string>>(new Set());
  readonly mapMode          = signal<'pins' | 'heatmap'>('pins');
  readonly heatMonth        = signal<number>(0);
  readonly treeExpandedNodes = signal<Set<string>>(new Set());

  // ─── Derived signals ────────────────────────────────────────────────────────
  readonly selectedSpecies = computed(() => {
    const key = this.selectedTaxonKey();
    if (key === null) return null;
    return this.species().find((s) => s.taxonKey === key) ?? null;
  });

  readonly isLoading = computed(() => this.status() === 'loading');
  readonly hasResults = computed(() => this.species().length > 0);

  // ─── Actions ────────────────────────────────────────────────────────────────
  search(lat: number, lon: number, radiusKm: number): void {
    this.coordinates.set({ lat, lon });
    this.radiusKm.set(radiusKm);
    this.status.set('loading');
    this.errorMessage.set(null);
    this.selectedTaxonKey.set(null);
    this.searchQuery.set('');
    this.selectedKingdoms.set(new Set());
    this.mapMode.set('pins');
    this.heatMonth.set(0);
    this.treeExpandedNodes.set(new Set());

    const cacheKey = this.cache.occurrenceKey(lat, lon, radiusKm);
    const cached = this.cache.get<GbifOccurrence[]>(cacheKey);
    if (cached) {
      this.applyOccurrences(cached);
      return;
    }

    this.gbif.searchOccurrences(lat, lon, radiusKm).pipe(
      switchMap((res) => {
        const occurrences = res.results;
        // Fetch a second page if there are more results
        if (!res.endOfRecords && res.count > 300) {
          return forkJoin([
            of(occurrences),
            this.gbif.searchOccurrences(lat, lon, radiusKm, 300).pipe(
              map((page2) => page2.results),
              catchError(() => of([] as GbifOccurrence[])),
            ),
          ]);
        }
        return of([occurrences, [] as GbifOccurrence[]]);
      }),
      catchError((err) => {
        this.status.set('error');
        this.errorMessage.set('Could not load species data. Please try again.');
        console.error('[SpeciesStore]', err);
        return of(null);
      }),
    ).subscribe((result) => {
      if (!result) return;
      const [page1, page2] = result as [GbifOccurrence[], GbifOccurrence[]];
      this.cache.set(cacheKey, [...page1, ...page2]);
      this.applyOccurrences([...page1, ...page2]);
    });
  }

  selectSpecies(taxonKey: number | null): void {
    this.selectedTaxonKey.set(taxonKey);
  }

  updateRadius(km: number): void {
    const coords = this.coordinates();
    if (!coords) return;
    this.search(coords.lat, coords.lon, km);
  }

  private applyOccurrences(occurrences: GbifOccurrence[]): void {
    const species = aggregateOccurrences(occurrences);
    this.species.set(species);
    this.status.set(species.length === 0 ? 'empty' : 'success');
  }
}
