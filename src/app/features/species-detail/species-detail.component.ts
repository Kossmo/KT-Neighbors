import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { InatService } from '../../core/api/inaturalist.service';
import { WikipediaService } from '../../core/api/wikipedia.service';
import { Species } from '../../core/models/species.model';
import { SpeciesStore } from '../../core/services/species-store';
import { MapComponent } from '../discovery/map/map.component';

interface PhotoSlide {
  url: string;
  source: 'gbif' | 'inat';
}

@Component({
  selector: 'app-species-detail',
  imports: [MapComponent],
  templateUrl: './species-detail.component.html',
  styleUrl: './species-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpeciesDetailComponent implements OnInit {
  readonly taxonKey = input.required<string>();

  private readonly store = inject(SpeciesStore);
  private readonly inat = inject(InatService);
  private readonly wiki = inject(WikipediaService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  readonly species  = signal<Species | null>(null);
  readonly enriching = signal(false);

  readonly photoSlides = signal<PhotoSlide[]>([]);
  readonly slideIndex  = signal(0);

  readonly hasMultipleSlides = computed(() => this.photoSlides().length > 1);

  readonly mapCoords = computed(() => {
    const s = this.species();
    if (!s || s.observations.length === 0) return null;
    const lat = s.observations.reduce((sum, o) => sum + o.lat, 0) / s.observations.length;
    const lon = s.observations.reduce((sum, o) => sum + o.lon, 0) / s.observations.length;
    return { lat, lon };
  });

  readonly displayName = computed(() => {
    const s = this.species();
    if (!s) return '';
    return s.vernacularName || s.scientificName;
  });

  readonly taxonomy = computed(() => {
    const s = this.species();
    if (!s) return [];
    return [
      { rank: 'Kingdom', value: s.kingdom },
      { rank: 'Phylum',  value: s.phylum },
      { rank: 'Class',   value: s.class },
      { rank: 'Order',   value: s.order },
      { rank: 'Family',  value: s.family },
      { rank: 'Genus',   value: s.genus },
    ].filter((t) => t.value);
  });

  ngOnInit(): void {
    const key = parseInt(this.taxonKey(), 10);
    if (isNaN(key)) { this.router.navigate(['/']); return; }

    const found = this.store.species().find((s) => s.taxonKey === key);
    if (!found) { this.router.navigate(['/']); return; }

    this.species.set(found);

    const initialUrl = found.representativePhoto?.url ?? null;
    if (initialUrl) {
      this.photoSlides.set([{ url: initialUrl, source: 'gbif' }]);
    }

    this.enrichSpecies(found);
  }

  nextSlide(): void {
    this.slideIndex.update(i => Math.min(i + 1, this.photoSlides().length - 1));
  }

  prevSlide(): void {
    this.slideIndex.update(i => Math.max(i - 1, 0));
  }

  onPhotoError(index: number): void {
    this.photoSlides.update(slides => slides.filter((_, i) => i !== index));
    const max = Math.max(0, this.photoSlides().length - 1);
    this.slideIndex.update(idx => Math.min(idx, max));
  }

  private enrichSpecies(s: Species): void {
    if (s.wikipediaSummary && s.inatPhoto) return;
    this.enriching.set(true);

    forkJoin({
      inat: this.inat.searchTaxon(s.scientificName).pipe(catchError(() => of(null))),
      wiki: this.wiki.getSummary(s.scientificName).pipe(catchError(() => of(null))),
    }).subscribe(({ inat, wiki }) => {
      this.species.update((current) => {
        if (!current) return current;
        return {
          ...current,
          inatTaxonId:      inat?.taxonId          ?? current.inatTaxonId,
          inatPhoto:        inat?.photo             ?? current.inatPhoto,
          vernacularName:   inat?.vernacularName    || current.vernacularName,
          wikipediaSummary: wiki?.extract           ?? current.wikipediaSummary,
          wikipediaUrl:     wiki?.content_urls?.desktop?.page ?? current.wikipediaUrl,
        };
      });

      // Silently add the iNat photo as a second slide — current slide never changes
      const inatUrl = inat?.photo?.url;
      if (inatUrl) {
        this.photoSlides.update(slides => {
          if (slides.some(sl => sl.url === inatUrl)) return slides;
          return [...slides, { url: inatUrl, source: 'inat' }];
        });
      }

      this.enriching.set(false);
    });
  }

  goBack(): void {
    this.location.back();
  }
}
