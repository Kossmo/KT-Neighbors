import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { GbifSearchResponse } from '../models/occurrence.model';

const GBIF_API = 'https://api.gbif.org/v1';

@Injectable({ providedIn: 'root' })
export class GbifService {
  private readonly http = inject(HttpClient);

  searchOccurrences(
    lat: number,
    lon: number,
    radiusKm: number,
    offset = 0,
    limit = 300,
    speciesKey?: number,
  ): Observable<GbifSearchResponse> {
    let params = new HttpParams()
      .set('geoDistance', `${lat},${lon},${radiusKm}km`)
      .set('mediaType', 'StillImage')
      .set('basisOfRecord', 'HUMAN_OBSERVATION')
      .set('hasCoordinate', 'true')
      .set('hasGeospatialIssue', 'false')
      .set('limit', limit)
      .set('offset', offset);

    if (speciesKey != null) {
      params = params.set('speciesKey', speciesKey);
    }

    return this.http.get<GbifSearchResponse>(`${GBIF_API}/occurrence/search`, { params });
  }

  searchOccurrencesBatch(
    lat: number,
    lon: number,
    radiusKm: number,
    speciesKeys: number[],
    limit = 300,
  ): Observable<GbifSearchResponse> {
    let params = new HttpParams()
      .set('geoDistance', `${lat},${lon},${radiusKm}km`)
      .set('mediaType', 'StillImage')
      .set('basisOfRecord', 'HUMAN_OBSERVATION')
      .set('hasCoordinate', 'true')
      .set('hasGeospatialIssue', 'false')
      .set('limit', limit);

    for (const key of speciesKeys) {
      params = params.append('speciesKey', key);
    }

    return this.http.get<GbifSearchResponse>(`${GBIF_API}/occurrence/search`, { params });
  }

  searchFacets(
    lat: number,
    lon: number,
    radiusKm: number,
    facetLimit: number,
  ): Observable<GbifSearchResponse> {
    const params = new HttpParams()
      .set('geoDistance', `${lat},${lon},${radiusKm}km`)
      .set('mediaType', 'StillImage')
      .set('basisOfRecord', 'HUMAN_OBSERVATION')
      .set('hasCoordinate', 'true')
      .set('hasGeospatialIssue', 'false')
      .set('limit', 0)
      .set('facet', 'SPECIES_KEY')
      .set('facetLimit', facetLimit);

    return this.http.get<GbifSearchResponse>(`${GBIF_API}/occurrence/search`, { params });
  }
}
