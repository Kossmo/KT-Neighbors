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
  ): Observable<GbifSearchResponse> {
    const params = new HttpParams()
      .set('geoDistance', `${lat},${lon},${radiusKm}km`)
      .set('mediaType', 'StillImage')
      .set('basisOfRecord', 'HUMAN_OBSERVATION')
      .set('hasCoordinate', 'true')
      .set('hasGeospatialIssue', 'false')
      .set('limit', limit)
      .set('offset', offset);

    return this.http.get<GbifSearchResponse>(`${GBIF_API}/occurrence/search`, { params });
  }
}
