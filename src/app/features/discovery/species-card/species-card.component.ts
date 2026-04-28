import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Species } from '../../../core/models/species.model';

@Component({
  selector: 'app-species-card',
  templateUrl: './species-card.component.html',
  styleUrl: './species-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpeciesCardComponent {
  readonly species = input.required<Species>();
  readonly selected = input(false);

  readonly cardSelected = output<void>();
  readonly detailRequested = output<void>();

  readonly photoError = signal(false);

  get photoUrl(): string | null {
    const s = this.species();
    return s.inatPhoto?.url ?? s.representativePhoto?.url ?? null;
  }

  get displayName(): string {
    const s = this.species();
    return s.vernacularName || s.scientificName;
  }

  get latinName(): string | null {
    const s = this.species();
    return s.vernacularName ? s.scientificName : null;
  }

  onPhotoError(): void {
    this.photoError.set(true);
  }
}
