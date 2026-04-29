import { Injectable } from '@angular/core';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class CacheService {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (Date.now() > entry.expiresAt) {
        localStorage.removeItem(key);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  set<T>(key: string, data: T): void {
    try {
      const entry: CacheEntry<T> = { data, expiresAt: Date.now() + TTL_MS };
      localStorage.setItem(key, JSON.stringify(entry));
    } catch {
      // localStorage quota exceeded — silently ignore
    }
  }

  // Build a stable key from lat/lon rounded to ~2km grid + radius
  occurrenceKey(lat: number, lon: number, radiusKm: number): string {
    const gridLat = Math.round(lat * 50) / 50;  // ~2km precision
    const gridLon = Math.round(lon * 50) / 50;
    return `neighbors:sp:${gridLat}:${gridLon}:${radiusKm}`;
  }
}
