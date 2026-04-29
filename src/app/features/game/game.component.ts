import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { InatService } from '../../core/api/inaturalist.service';
import { Species } from '../../core/models/species.model';
import { SpeciesStore } from '../../core/services/species-store';

type GameStatus = 'playing' | 'answered' | 'finished';

interface GameRound {
  species: Species;
  choices: Choice[];
}

interface Choice {
  name: string;
  isCorrect: boolean;
  isScientific: boolean;
}

const ROUNDS = 10;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

@Component({
  selector: 'app-game',
  templateUrl: './game.component.html',
  styleUrl: './game.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameComponent implements OnInit {
  private readonly store    = inject(SpeciesStore);
  private readonly router   = inject(Router);
  private readonly location = inject(Location);
  private readonly inat     = inject(InatService);

  readonly rounds      = signal<GameRound[]>([]);
  readonly roundIndex  = signal(0);
  readonly score       = signal(0);
  readonly status      = signal<GameStatus>('playing');
  readonly pickedName  = signal<string | null>(null);
  readonly photoUrl    = signal<string | null>(null);
  readonly loadingInat = signal(false);

  readonly currentRound = computed(() => this.rounds()[this.roundIndex()]);
  readonly progressDots = computed(() => Array.from({ length: this.rounds().length }, (_, i) => i));

  readonly scoreMessage = computed(() => {
    const s = this.score();
    const t = this.rounds().length;
    const r = t > 0 ? s / t : 0;
    if (r === 1)  return 'Perfect. A true naturalist.';
    if (r >= 0.8) return 'Excellent field skills.';
    if (r >= 0.6) return 'Not bad for a city dweller.';
    if (r >= 0.4) return 'Keep exploring your neighborhood.';
    return 'The wildlife remains a mystery to you.';
  });

  ngOnInit(): void {
    const species = this.store.species();
    if (!species.length) { this.router.navigate(['/']); return; }
    this.buildRounds(species);
  }

  pick(choice: Choice): void {
    if (this.status() !== 'playing') return;
    this.pickedName.set(choice.name);
    if (choice.isCorrect) this.score.update(s => s + 1);
    this.status.set('answered');
  }

  next(): void {
    const next = this.roundIndex() + 1;
    if (next >= this.rounds().length) {
      this.status.set('finished');
    } else {
      this.roundIndex.set(next);
      this.pickedName.set(null);
      this.loadingInat.set(false);
      this.photoUrl.set(this.rounds()[next].species.representativePhoto?.url ?? null);
      this.status.set('playing');
    }
  }

  restart(): void {
    this.score.set(0);
    this.roundIndex.set(0);
    this.pickedName.set(null);
    this.loadingInat.set(false);
    this.status.set('playing');
    this.buildRounds(this.store.species());
  }

  goBack(): void {
    this.location.back();
  }

  onPhotoError(): void {
    if (this.loadingInat()) return;
    const round = this.currentRound();
    if (!round) return;

    const taxonKey = round.species.taxonKey;
    this.loadingInat.set(true);

    this.inat.searchTaxon(round.species.scientificName).pipe(
      catchError(() => of(null)),
    ).subscribe(result => {
      if (this.currentRound()?.species.taxonKey !== taxonKey) return;

      this.loadingInat.set(false);
      const url = result?.photo?.url;
      if (url) {
        this.photoUrl.set(url);
      } else {
        this.skipRound();
      }
    });
  }

  private buildRounds(allSpecies: Species[]): void {
    const withPhoto = allSpecies.filter(s => s.representativePhoto?.url);
    if (withPhoto.length < 4) { this.router.navigate(['/']); return; }

    const questions = shuffle(withPhoto).slice(0, ROUNDS);
    const rounds = questions.map(sp => ({
      species: sp,
      choices: this.buildChoices(sp, allSpecies),
    }));
    this.rounds.set(rounds);
    this.photoUrl.set(rounds[0]?.species.representativePhoto?.url ?? null);
  }

  private buildChoices(correct: Species, all: Species[]): Choice[] {
    const toChoice = (s: Species, isCorrect: boolean): Choice => ({
      name: s.vernacularName || s.scientificName,
      isCorrect,
      isScientific: !s.vernacularName,
    });

    const sameKingdom = shuffle(all.filter(s => s.taxonKey !== correct.taxonKey && s.kingdom === correct.kingdom));
    const otherPool   = shuffle(all.filter(s => s.taxonKey !== correct.taxonKey && s.kingdom !== correct.kingdom));
    const distractors = [...sameKingdom, ...otherPool].slice(0, 3);

    return shuffle([toChoice(correct, true), ...distractors.map(s => toChoice(s, false))]);
  }

  private skipRound(): void {
    const next = this.roundIndex() + 1;
    if (next >= this.rounds().length) {
      this.status.set('finished');
    } else {
      this.roundIndex.set(next);
      this.pickedName.set(null);
      this.photoUrl.set(this.rounds()[next].species.representativePhoto?.url ?? null);
      this.status.set('playing');
    }
  }
}
