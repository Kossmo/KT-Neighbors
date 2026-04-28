import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

const WIKI_API = 'https://en.wikipedia.org/api/rest_v1/page/summary';

export interface WikiSummary {
  extract: string;
  content_urls?: { desktop?: { page: string } };
}

@Injectable({ providedIn: 'root' })
export class WikipediaService {
  private readonly http = inject(HttpClient);

  getSummary(title: string): Observable<WikiSummary | null> {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'));
    return this.http.get<WikiSummary>(`${WIKI_API}/${encoded}`).pipe(
      catchError(() => of(null)),
    );
  }
}
