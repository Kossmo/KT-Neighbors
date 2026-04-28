import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Species } from '../../../core/models/species.model';
import { SearchStatus } from '../../../core/services/species-store';
import { SpeciesCardComponent } from '../species-card/species-card.component';

@Component({
  selector: 'app-species-list',
  imports: [SpeciesCardComponent],
  templateUrl: './species-list.component.html',
  styleUrl: './species-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpeciesListComponent {
  readonly species = input.required<Species[]>();
  readonly status = input.required<SearchStatus>();
  readonly selectedKey = input<number | null>(null);

  readonly speciesSelected = output<number | null>();
  readonly speciesDetail = output<number>();

  readonly skeletons = Array.from({ length: 8 });

  selectSpecies(taxonKey: number): void {
    const current = this.selectedKey();
    this.speciesSelected.emit(current === taxonKey ? null : taxonKey);
  }

  openDetail(taxonKey: number): void {
    this.speciesDetail.emit(taxonKey);
  }
}
