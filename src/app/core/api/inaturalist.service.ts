import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { SpeciesPhoto } from '../models/species.model';

const INAT_API = 'https://api.inaturalist.org/v1';

interface InatTaxon {
  id: number;
  name: string;
  preferred_common_name?: string;
  default_photo?: {
    medium_url: string;
    attribution: string;
    license_code: string;
  };
}

interface InatSearchResponse {
  results: InatTaxon[];
  total_results: number;
}

export interface InatEnrichment {
  taxonId: number;
  vernacularName: string;
  photo: SpeciesPhoto | null;
}

@Injectable({ providedIn: 'root' })
export class InatService {
  private readonly http = inject(HttpClient);

  searchTaxon(scientificName: string): Observable<InatEnrichment | null> {
    const params = new HttpParams()
      .set('q', scientificName)
      .set('rank', 'species')
      .set('per_page', '1');

    return this.http
      .get<InatSearchResponse>(`${INAT_API}/taxa/autocomplete`, { params })
      .pipe(
        map((res) => {
          const taxon = res.results?.[0];
          if (!taxon) return null;
          return {
            taxonId: taxon.id,
            vernacularName: taxon.preferred_common_name ?? '',
            photo: taxon.default_photo
              ? {
                  url: taxon.default_photo.medium_url,
                  credit: taxon.default_photo.attribution,
                  license: taxon.default_photo.license_code,
                }
              : null,
          };
        }),
        catchError(() => of(null)),
      );
  }
}
