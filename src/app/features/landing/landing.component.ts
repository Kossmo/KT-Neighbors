import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, of, switchMap, takeUntil } from 'rxjs';
import { GeolocationService, PhotonSuggestion } from '../../core/services/geolocation.service';
import { SpeciesStore } from '../../core/services/species-store';

type LandingState = 'idle' | 'detecting' | 'geocoding' | 'error';

@Component({
  selector: 'app-landing',
  imports: [FormsModule],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingComponent implements OnInit, OnDestroy {
  private readonly geo = inject(GeolocationService);
  private readonly store = inject(SpeciesStore);
  private readonly router = inject(Router);

  private readonly inputSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  readonly state = signal<LandingState>('idle');
  readonly errorMsg = signal<string | null>(null);
  readonly suggestions = signal<PhotonSuggestion[]>([]);
  readonly activeIdx = signal(-1);
  readonly showSuggestions = signal(false);

  addressInput = '';

  ngOnInit(): void {
    this.inputSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => (q.length >= 2 ? this.geo.autocompleteAddress(q) : of([]))),
        takeUntil(this.destroy$),
      )
      .subscribe((list) => {
        this.suggestions.set(list);
        this.activeIdx.set(-1);
        this.showSuggestions.set(list.length > 0);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onInputChange(value: string): void {
    this.addressInput = value;
    if (!value.trim()) {
      this.closeSuggestions();
    }
    this.inputSubject.next(value);
  }

  onKeydown(event: KeyboardEvent): void {
    const list = this.suggestions();
    if (!list.length || !this.showSuggestions()) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIdx.update((i) => Math.min(i + 1, list.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIdx.update((i) => Math.max(i - 1, -1));
    } else if (event.key === 'Escape') {
      this.closeSuggestions();
    }
  }

  onInputBlur(): void {
    // Delay so mousedown on a suggestion fires before the dropdown hides
    setTimeout(() => this.closeSuggestions(), 150);
  }

  selectSuggestion(s: PhotonSuggestion): void {
    this.addressInput = s.label;
    this.closeSuggestions();
    this.store.locationName.set(s.label);
    this.navigateToDiscovery(s.lat, s.lon);
  }

  beginDetection(): void {
    this.state.set('detecting');
    this.errorMsg.set(null);

    this.geo.detectPosition().subscribe({
      next: (coords) => {
        this.geo.reverseGeocode(coords.lat, coords.lon).subscribe((name) => {
          this.store.locationName.set(name);
          this.navigateToDiscovery(coords.lat, coords.lon);
        });
      },
      error: () => {
        this.state.set('idle');
        this.errorMsg.set('Location access denied. Please enter an address below.');
      },
    });
  }

  submitAddress(): void {
    const active = this.activeIdx();
    const list = this.suggestions();
    if (active >= 0 && list[active]) {
      this.selectSuggestion(list[active]);
      return;
    }

    const addr = this.addressInput.trim();
    if (!addr) return;
    this.closeSuggestions();
    this.state.set('geocoding');
    this.errorMsg.set(null);

    this.geo.geocodeAddress(addr).subscribe({
      next: (loc) => {
        this.store.locationName.set(loc.displayName);
        this.navigateToDiscovery(loc.lat, loc.lon);
      },
      error: () => {
        this.state.set('error');
        this.errorMsg.set('Address not found. Please try a different search.');
      },
    });
  }

  retryFromError(): void {
    this.state.set('idle');
    this.errorMsg.set(null);
  }

  private closeSuggestions(): void {
    this.showSuggestions.set(false);
    this.activeIdx.set(-1);
  }

  private navigateToDiscovery(lat: number, lon: number): void {
    this.store.searchQuery.set('');
    this.store.selectedKingdoms.set(new Set());
    this.router.navigate(['/discovery'], {
      queryParams: { lat: lat.toFixed(6), lon: lon.toFixed(6) },
    });
  }
}
