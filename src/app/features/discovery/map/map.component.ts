import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { Circle, CircleMarker, Map as LeafletMap, LayerGroup, Marker } from 'leaflet';
import { Species } from '../../../core/models/species.model';

// ─── Pin icons ────────────────────────────────────────────────────────────────
type PinState = 'active' | 'selected' | 'dimmed';

const PIN_CONFIG: Record<PinState, { size: number; color: string; stroke: string; opacity: number }> = {
  active:   { size: 12, color: '#c4873a', stroke: '#ffffff', opacity: 0.9 },
  selected: { size: 20, color: '#9a5f1e', stroke: '#ffffff', opacity: 1 },
  dimmed:   { size: 8,  color: '#b8b0a8', stroke: 'none',    opacity: 0.3 },
};

function makePinIcon(state: PinState, L: typeof import('leaflet')): import('leaflet').DivIcon {
  const { size, color, stroke, opacity } = PIN_CONFIG[state];
  const r = size / 2 - 1.5;
  const strokeAttr = stroke !== 'none' ? `stroke="${stroke}" stroke-width="2"` : '';
  let svg: string;
  if (state === 'selected') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2+5}" fill="rgba(196,135,58,0.18)" stroke="#c4873a" stroke-width="1" stroke-dasharray="3 2" opacity="0.7"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="${color}" ${strokeAttr} opacity="${opacity}"/></svg>`;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="${color}" ${strokeAttr} opacity="${opacity}"/></svg>`;
  }
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// ─── Heatmap slot type ────────────────────────────────────────────────────────
export interface HeatSlot { month: number; year: number; label: string; short: string; }

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrl: './map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapComponent implements AfterViewInit, OnDestroy {
  // ─── Inputs ─────────────────────────────────────────────────────────────────
  readonly species    = input.required<Species[]>();
  readonly selectedKey = input<number | null>(null);
  readonly coordinates = input.required<{ lat: number; lon: number }>();
  readonly radiusKm   = input<number>(5);
  readonly mode       = input<'pins' | 'heatmap'>('pins');
  readonly heatData   = input<{ lat: number; lon: number }[][]>([]);
  readonly heatSlots  = input<HeatSlot[]>([]);

  readonly initialHeatMonth = input<number>(0);

  readonly speciesClicked = output<number>();
  readonly monthChanged   = output<number>();

  // ─── View refs ───────────────────────────────────────────────────────────────
  private readonly mapElRef = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');

  // ─── Leaflet state ───────────────────────────────────────────────────────────
  private map: LeafletMap | null = null;
  private L: typeof import('leaflet') | null = null;
  private markersByKey = new Map<number, Marker[]>();
  private layerGroup: LayerGroup | null = null;
  private radiusCircle: Circle | null = null;
  private userDot: CircleMarker | null = null;

  // ─── Heatmap state ───────────────────────────────────────────────────────────
  private heatCanvas: HTMLCanvasElement | null = null;
  private animTimer: ReturnType<typeof setInterval> | null = null;

  readonly currentMonth = signal(0);
  readonly isPlaying    = signal(false);
  readonly monthLabel = computed(() => this.heatSlots()[this.currentMonth()]?.label ?? '');

  private readonly zone = inject(NgZone);

  constructor() {
    // Re-render pins when species list changes (pins mode only)
    effect(() => {
      const species = this.species();
      if (this.map && this.L && this.mode() === 'pins') {
        this.renderMarkers(species);
      }
    });

    // Update pin styles when selection changes (pins mode only)
    effect(() => {
      const key = this.selectedKey();
      if (this.map && this.L && this.mode() === 'pins') {
        this.updateMarkerStyles(key);
      }
    });

    // Update radius circle when radiusKm changes
    effect(() => {
      const km = this.radiusKm();
      if (this.radiusCircle) this.radiusCircle.setRadius(km * 1000);
    });

    // Switch between pins and heatmap modes
    effect(() => {
      const mode = this.mode();
      if (!this.map || !this.L) return;

      if (mode === 'heatmap') {
        this.layerGroup?.clearLayers();
        this.showHeatCanvas();
        this.currentMonth.set(this.initialHeatMonth());
        this.isPlaying.set(true);
        this.startAnimation();
      } else {
        this.stopAnimation();
        this.isPlaying.set(false);
        this.hideHeatCanvas();
        this.renderMarkers(this.species());
      }
    });

    // Redraw heatmap canvas when month or data changes, and notify parent
    effect(() => {
      const month = this.currentMonth();
      const data  = this.heatData();
      const mode  = this.mode();
      if (mode === 'heatmap' && this.map && this.heatCanvas && this.L) {
        this.monthChanged.emit(month);
        this.drawHeat(data[month] ?? []);
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const L = await import('leaflet');
    this.L = L;

    const coords = this.coordinates();
    const mapEl  = this.mapElRef().nativeElement;

    this.map = L.map(mapEl, { center: [coords.lat, coords.lon], zoom: 13, zoomControl: false });
    L.control.zoom({ position: 'topleft' }).addTo(this.map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      minZoom: 1, maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(this.map);

    this.radiusCircle = L.circle([coords.lat, coords.lon], {
      radius: this.radiusKm() * 1000,
      color: '#c4873a', weight: 1.5, dashArray: '6 4',
      fillColor: '#c4873a', fillOpacity: 0.04, opacity: 0.5, interactive: false,
    }).addTo(this.map);

    this.userDot = L.circleMarker([coords.lat, coords.lon], {
      radius: 5, color: '#ffffff', weight: 2,
      fillColor: '#c4873a', fillOpacity: 1, interactive: false,
    }).addTo(this.map);

    this.layerGroup = L.layerGroup().addTo(this.map);

    this.setupHeatCanvas();

    if (this.mode() === 'heatmap') {
      this.currentMonth.set(this.initialHeatMonth());
      this.showHeatCanvas();
      this.drawHeat(this.heatData()[this.initialHeatMonth()] ?? []);
    } else if (this.species().length > 0) {
      this.renderMarkers(this.species());
    }
  }

  ngOnDestroy(): void {
    this.stopAnimation();
    this.heatCanvas?.remove();
    this.map?.remove();
    this.map = null;
  }

  // ─── Heatmap canvas ──────────────────────────────────────────────────────────
  private setupHeatCanvas(): void {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:450;display:none;';
    this.map!.getContainer().appendChild(canvas);
    this.heatCanvas = canvas;
    this.syncCanvasSize();

    this.map!.on('move zoom', () => {
      if (this.mode() === 'heatmap') this.drawHeat(this.heatData()[this.currentMonth()] ?? []);
    });
    this.map!.on('resize', () => {
      this.syncCanvasSize();
      if (this.mode() === 'heatmap') this.drawHeat(this.heatData()[this.currentMonth()] ?? []);
    });
  }

  private syncCanvasSize(): void {
    if (!this.heatCanvas || !this.map) return;
    const c = this.map.getContainer();
    this.heatCanvas.width  = c.clientWidth;
    this.heatCanvas.height = c.clientHeight;
  }

  private showHeatCanvas(): void { if (this.heatCanvas) this.heatCanvas.style.display = 'block'; }
  private hideHeatCanvas(): void {
    if (!this.heatCanvas) return;
    this.heatCanvas.style.display = 'none';
    this.heatCanvas.getContext('2d')?.clearRect(0, 0, this.heatCanvas.width, this.heatCanvas.height);
  }

  private drawHeat(points: { lat: number; lon: number }[]): void {
    if (!this.heatCanvas || !this.map) return;
    const canvas = this.heatCanvas;
    const ctx    = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const pt of points) {
      const pos = this.map.latLngToContainerPoint([pt.lat, pt.lon]);

      // Skip points well outside the viewport
      if (pos.x < -60 || pos.x > canvas.width + 60 || pos.y < -60 || pos.y > canvas.height + 60) continue;

      const r = 34;
      const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, r);
      g.addColorStop(0,   'rgba(74, 106, 122, 0.30)');
      g.addColorStop(0.45,'rgba(74, 106, 122, 0.12)');
      g.addColorStop(1,   'rgba(74, 106, 122, 0)');
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  // ─── Animation ───────────────────────────────────────────────────────────────
  startAnimation(): void {
    this.stopAnimation();
    this.zone.runOutsideAngular(() => {
      this.animTimer = setInterval(() => {
        this.currentMonth.update(m => (m + 1) % 12);
      }, 2500);
    });
  }

  stopAnimation(): void {
    if (this.animTimer !== null) { clearInterval(this.animTimer); this.animTimer = null; }
  }

  togglePlay(): void {
    if (this.isPlaying()) {
      this.isPlaying.set(false);
      this.stopAnimation();
    } else {
      this.isPlaying.set(true);
      this.startAnimation();
    }
  }

  setMonth(i: number): void {
    this.currentMonth.set(i);
    this.isPlaying.set(false);
    this.stopAnimation();
  }

  // ─── Markers ─────────────────────────────────────────────────────────────────
  private renderMarkers(species: Species[]): void {
    const L = this.L!;
    const selectedKey = this.selectedKey();
    this.layerGroup!.clearLayers();
    this.markersByKey.clear();

    const dimmedSpecies = species.filter(s => selectedKey !== null && s.taxonKey !== selectedKey);
    const activeSpecies = species.filter(s => selectedKey === null || s.taxonKey === selectedKey);

    for (const sp of [...dimmedSpecies, ...activeSpecies]) {
      const state: PinState =
        selectedKey === null        ? 'active'   :
        sp.taxonKey === selectedKey ? 'selected' : 'dimmed';

      const zOffset = state === 'selected' ? 1000 : state === 'dimmed' ? -100 : 0;
      const markers: Marker[] = [];

      for (const obs of sp.observations) {
        const marker = L.marker([obs.lat, obs.lon], {
          icon: makePinIcon(state, L),
          title: sp.vernacularName || sp.scientificName,
          zIndexOffset: zOffset,
        });
        marker.on('click', () => this.speciesClicked.emit(sp.taxonKey));
        marker.bindTooltip(
          `<strong>${sp.vernacularName || sp.scientificName}</strong><br>
           <em style="font-size:0.85em">${sp.vernacularName ? sp.scientificName : ''}</em>`,
          { direction: 'top', offset: [0, -6] },
        );
        this.layerGroup!.addLayer(marker);
        markers.push(marker);
      }
      this.markersByKey.set(sp.taxonKey, markers);
    }
  }

  private updateMarkerStyles(selectedKey: number | null): void {
    const L = this.L!;
    const dimmedKeys = [...this.markersByKey.keys()].filter(k => selectedKey !== null && k !== selectedKey);
    const activeKeys = [...this.markersByKey.keys()].filter(k => selectedKey === null || k === selectedKey);

    for (const key of [...dimmedKeys, ...activeKeys]) {
      const state: PinState =
        selectedKey === null ? 'active' :
        key === selectedKey  ? 'selected' : 'dimmed';
      const zOffset = state === 'selected' ? 1000 : state === 'dimmed' ? -100 : 0;
      const icon    = makePinIcon(state, L);
      for (const marker of this.markersByKey.get(key) ?? []) {
        marker.setIcon(icon);
        marker.setZIndexOffset(zOffset);
      }
    }
  }
}
