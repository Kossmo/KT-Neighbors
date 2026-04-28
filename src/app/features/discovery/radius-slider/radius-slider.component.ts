import { ChangeDetectionStrategy, Component, input, OnDestroy, output, signal } from '@angular/core';

@Component({
  selector: 'app-radius-slider',
  templateUrl: './radius-slider.component.html',
  styleUrl: './radius-slider.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadiusSliderComponent implements OnDestroy {
  readonly currentValue = input.required<number>();
  readonly radiusChanged = output<number>();

  readonly expanded = signal(false);
  readonly localValue = signal(5);

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  toggle(): void {
    if (!this.expanded()) {
      this.localValue.set(this.currentValue());
    }
    this.expanded.update((v) => !v);
  }

  onSliderInput(event: Event): void {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    this.localValue.set(val);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.radiusChanged.emit(val);
    }, 500);
  }

  ngOnDestroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}
