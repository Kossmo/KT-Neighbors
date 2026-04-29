import { computed, inject, Injectable, signal } from '@angular/core';
import { forkJoin, from, of } from 'rxjs';
import { catchError, map, mergeMap, switchMap, toArray } from 'rxjs/operators';
import { GbifService } from '../api/gbif.service';
import { GbifOccurrence, GbifSearchResponse } from '../models/occurrence.model';
import { Species } from '../models/species.model';
import { CacheService } from './cache.service';
import { aggregateOccurrences } from '../utils/species-aggregator';

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error' | 'empty';

const MISSING_CAP = 500;
const BATCH_SIZE = 25;
const BATCH_CONCURRENCY = 8;
const NUM_SPREAD_PAGES = 3;
// GBIF rejects offsets > 100 000 without cursor-based deep paging
const GBIF_MAX_OFFSET = 99700;

const EMPTY_RESPONSE: GbifSearchResponse = {
  results: [],
  count: 0,
  offset: 0,
  limit: 0,
  endOfRecords: true,
};

// Spread N page offsets evenly across the full dataset so each page samples
// a different time window, maximising species diversity across pages.
function spreadOffsets(count: number, numPages: number, pageSize: number): number[] {
  const maxOffset = Math.min(GBIF_MAX_OFFSET, Math.max(0, count - pageSize));
  return Array.from({ length: numPages }, (_, i) =>
    Math.floor((maxOffset / Math.max(numPages - 1, 1)) * i),
  );
}

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
    const cached = this.cache.get<Species[]>(cacheKey);
    if (cached) {
      this.species.set(cached);
      this.status.set(cached.length === 0 ? 'empty' : 'success');
      return;
    }

    // 500 flat up to 5 km, then +50 per km above 5 km
    const facetLimit = 500 + Math.max(0, radiusKm - 5) * 50;

    // Phase 1 – facets only (fast: limit=0), gives total count + full species list
    this.gbif.searchFacets(lat, lon, radiusKm, facetLimit).pipe(
      catchError(() => of(EMPTY_RESPONSE)),
      // Phase 2 – spread NUM_SPREAD_PAGES occurrence pages across the whole dataset
      switchMap(facets => {
        const offsets = spreadOffsets(facets.count, NUM_SPREAD_PAGES, 300);
        return forkJoin(
          offsets.map(offset =>
            this.gbif.searchOccurrences(lat, lon, radiusKm, offset).pipe(
              catchError(() => of(EMPTY_RESPONSE)),
            ),
          ),
        ).pipe(map(pages => ({ facets, pages })));
      }),
      // Phase 3 – batch-fetch remaining species not covered by occurrence pages
      switchMap(({ facets, pages }) => {
        const allOccurrences = pages.flatMap(p => p.results);
        const coveredKeys = new Set(
          allOccurrences
            .map(o => o.speciesKey ?? o.taxonKey)
            .filter((k): k is number => k != null),
        );

        const facetCounts = facets.facets?.[0]?.counts ?? [];
        const missing = facetCounts
          .filter(f => !coveredKeys.has(Number(f.name)))
          .slice(0, MISSING_CAP);

        if (missing.length === 0) {
          return of({ allOccurrences, batchOccurrences: [] as GbifOccurrence[], facetCountMap: new Map<number, number>() });
        }

        const facetCountMap = new Map(missing.map(f => [Number(f.name), Number(f.count)]));

        const batches: number[][] = [];
        for (let i = 0; i < missing.length; i += BATCH_SIZE) {
          batches.push(missing.slice(i, i + BATCH_SIZE).map(f => Number(f.name)));
        }

        return from(batches).pipe(
          mergeMap(
            keys => this.gbif.searchOccurrencesBatch(lat, lon, radiusKm, keys).pipe(
              map(res => res.results),
              catchError(() => of([] as GbifOccurrence[])),
            ),
            BATCH_CONCURRENCY,
          ),
          toArray(),
          map(batchResults => ({
            allOccurrences,
            batchOccurrences: batchResults.flat(),
            facetCountMap,
          })),
        );
      }),
      catchError(err => {
        this.status.set('error');
        this.errorMessage.set('Could not load species data. Please try again.');
        console.error('[SpeciesStore]', err);
        return of(null);
      }),
    ).subscribe(result => {
      if (!result) return;
      const { allOccurrences, batchOccurrences, facetCountMap } = result;

      const mainSpecies = aggregateOccurrences(allOccurrences);
      const coveredKeys = new Set(mainSpecies.map(s => s.taxonKey));

      // Override count with the accurate facet value for batch-fetched species
      const extraSpecies = aggregateOccurrences(batchOccurrences)
        .filter(s => !coveredKeys.has(s.taxonKey))
        .map(s => ({
          ...s,
          occurrenceCount: facetCountMap.get(s.taxonKey) ?? s.occurrenceCount,
        }));

      const allSpecies = [...mainSpecies, ...extraSpecies]
        .sort((a, b) => b.occurrenceCount - a.occurrenceCount);

      this.cache.set(cacheKey, allSpecies);
      this.species.set(allSpecies);
      this.status.set(allSpecies.length === 0 ? 'empty' : 'success');
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
}
