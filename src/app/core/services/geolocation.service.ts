import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { from, Observable, switchMap, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface GeocodedLocation extends Coordinates {
  displayName: string;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  private readonly http = inject(HttpClient);

  // Detect user position via browser API
  detectPosition(): Observable<Coordinates> {
    return new Observable((observer) => {
      if (!navigator.geolocation) {
        observer.error(new Error('Geolocation not supported by this browser'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          observer.next({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          observer.complete();
        },
        (err) => observer.error(err),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
      );
    });
  }

  // Forward geocoding: address string → coordinates + display name
  geocodeAddress(address: string): Observable<GeocodedLocation> {
    const params = new HttpParams()
      .set('q', address)
      .set('format', 'json')
      .set('limit', '1');

    return this.http
      .get<NominatimResult[]>(`${NOMINATIM}/search`, {
        params,
        headers: { 'Accept-Language': 'en' },
      })
      .pipe(
        map((results) => {
          const r = results?.[0];
          if (!r) throw new Error(`Address not found: ${address}`);
          return {
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            displayName: r.display_name,
          };
        }),
        catchError((err) => throwError(() => err)),
      );
  }

  // Reverse geocoding: coordinates → display name
  reverseGeocode(lat: number, lon: number): Observable<string> {
    const params = new HttpParams()
      .set('lat', lat)
      .set('lon', lon)
      .set('format', 'json')
      .set('zoom', '10');

    return this.http
      .get<NominatimReverseResult>(`${NOMINATIM}/reverse`, {
        params,
        headers: { 'Accept-Language': 'en' },
      })
      .pipe(
        map((r) => {
          const city =
            r.address?.city ?? r.address?.town ?? r.address?.village ?? r.address?.county ?? '';
          const country = r.address?.country ?? '';
          return city ? `${city}, ${country}` : r.display_name ?? 'your area';
        }),
        catchError(() => from(['your area'])),
      );
  }
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface NominatimReverseResult {
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    country?: string;
  };
}
