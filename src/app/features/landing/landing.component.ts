import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GeolocationService } from '../../core/services/geolocation.service';
import { SpeciesStore } from '../../core/services/species-store';

type LandingState = 'idle' | 'detecting' | 'geocoding' | 'error';

@Component({
  selector: 'app-landing',
  imports: [FormsModule],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingComponent {
  private readonly geo = inject(GeolocationService);
  private readonly store = inject(SpeciesStore);
  private readonly router = inject(Router);

  readonly state = signal<LandingState>('idle');
  readonly errorMsg = signal<string | null>(null);
  addressInput = '';

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
        // Geolocation denied — back to idle so the user can type an address
        this.state.set('idle');
        this.errorMsg.set('Location access denied. Please enter an address below.');
      },
    });
  }

  submitAddress(): void {
    const addr = this.addressInput.trim();
    if (!addr) return;
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

  private navigateToDiscovery(lat: number, lon: number): void {
    this.store.searchQuery.set('');
    this.store.selectedKingdoms.set(new Set());
    this.router.navigate(['/discovery'], {
      queryParams: { lat: lat.toFixed(6), lon: lon.toFixed(6) },
    });
  }
}
