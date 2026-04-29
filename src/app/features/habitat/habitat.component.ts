import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import type { ZoomBehavior } from 'd3';
import { Species } from '../../core/models/species.model';
import { SpeciesStore } from '../../core/services/species-store';

interface GraphNode {
  id: number;
  name: string;
  scientificName: string;
  kingdom: string;
  family: string;
  genus: string;
  order: string;
  occurrenceCount: number;
  photo: string | null;
  r: number;
  // D3 simulation fields
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: number | GraphNode;
  target: number | GraphNode;
  strength: number;
  rank: 'genus' | 'family';
}

interface Tooltip {
  name: string;
  scientificName: string;
  family: string;
  count: number;
  photo: string | null;
}

const KINGDOM_COLORS: Record<string, string> = {
  Animalia:  '#c4873a',
  Plantae:   '#5c7a4e',
  Fungi:     '#a85050',
  Chromista: '#4a6a7a',
  Protozoa:  '#a08070',
};

@Component({
  selector: 'app-habitat',
  templateUrl: './habitat.component.html',
  styleUrl: './habitat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HabitatComponent implements AfterViewInit, OnDestroy {
  private readonly store    = inject(SpeciesStore);
  private readonly router   = inject(Router);
  private readonly location = inject(Location);
  private readonly zone     = inject(NgZone);

  private readonly svgRef  = viewChild.required<ElementRef<SVGSVGElement>>('svgEl');
  private readonly wrapRef = viewChild.required<ElementRef<HTMLDivElement>>('wrapEl');

  private readonly abort = new AbortController();

  readonly locationName = this.store.locationName;
  readonly speciesCount = computed(() => this.store.species().length);
  readonly tooltip      = signal<Tooltip | null>(null);

  ngAfterViewInit(): void {
    const species = this.store.species();
    if (!species.length) { this.router.navigate(['/']); return; }
    this.render(species);
  }

  ngOnDestroy(): void {
    this.abort.abort();
  }

  goBack(): void {
    this.location.back();
  }

  private async render(allSpecies: Species[]): Promise<void> {
    const d3   = await import('d3');
    const wrap = this.wrapRef().nativeElement;
    const svg  = this.svgRef().nativeElement;
    const w    = wrap.clientWidth;
    const h    = wrap.clientHeight;

    const nodes: GraphNode[] = allSpecies.map(sp => ({
      id:              sp.taxonKey,
      name:            sp.vernacularName || sp.scientificName,
      scientificName:  sp.scientificName,
      kingdom:         sp.kingdom,
      family:          sp.family,
      genus:           sp.genus,
      order:           sp.order,
      occurrenceCount: sp.occurrenceCount,
      photo:           sp.representativePhoto?.url ?? null,
      r:               Math.max(7, Math.min(26, Math.sqrt(sp.occurrenceCount) * 2.0)),
    }));

    const links = this.buildLinks(nodes);

    // ─── SVG setup ────────────────────────────────────────────────────────────
    const root = d3.select<SVGSVGElement, unknown>(svg).attr('width', w).attr('height', h);
    const g         = root.append('g');
    const linkGroup = g.append('g').attr('class', 'links');
    const nodeGroup = g.append('g').attr('class', 'nodes');

    // Zoom + pan (scaleExtent min updated once simulation settles)
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 5])
      .on('zoom', e => g.attr('transform', e.transform));
    root.call(zoom).on('dblclick.zoom', null);

    // ─── Links ────────────────────────────────────────────────────────────────
    const linkSel = linkGroup.selectAll<SVGLineElement, GraphLink>('line')
      .data(links).enter().append('line')
      .attr('stroke', d => d.rank === 'genus'
        ? 'rgba(196,135,58,0.55)'
        : 'rgba(180,160,130,0.22)')
      .attr('stroke-width', d => d.rank === 'genus' ? 1.5 : 0.8);

    // ─── Nodes ────────────────────────────────────────────────────────────────
    const nodeSel = nodeGroup.selectAll<SVGCircleElement, GraphNode>('circle')
      .data(nodes).enter().append('circle')
      .attr('r', d => d.r)
      .attr('fill', d => KINGDOM_COLORS[d.kingdom] ?? '#a08070')
      .attr('fill-opacity', 0.82)
      .attr('stroke', '#16130f')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer');

    // ─── Interaction ─────────────────────────────────────────────────────────
    const sig = this.abort.signal;

    // Track tooltip position via CSS custom properties (no zone involvement)
    this.zone.runOutsideAngular(() => {
      svg.addEventListener('mousemove', (e: MouseEvent) => {
        const rect = svg.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const tipEl = wrap.querySelector<HTMLElement>('.habitat__tooltip');
        const tipH = tipEl?.offsetHeight ?? 320;
        const flipUp = cursorY + tipH + 24 > h;
        wrap.style.setProperty('--tip-x', `${cursorX + 16}px`);
        wrap.style.setProperty('--tip-y', flipUp ? `${cursorY - tipH - 8}px` : `${cursorY - 12}px`);
      }, { signal: sig });
    });

    nodeSel.on('mouseenter', (_e: MouseEvent, d: GraphNode) => {
      // Highlight neighbors
      const neighborIds = new Set<number>();
      neighborIds.add(d.id);
      for (const l of links) {
        const s = (l.source as GraphNode).id;
        const t = (l.target as GraphNode).id;
        if (s === d.id) neighborIds.add(t);
        if (t === d.id) neighborIds.add(s);
      }
      nodeSel
        .attr('fill-opacity', n => neighborIds.has(n.id) ? 0.95 : 0.12)
        .attr('stroke-opacity', n => neighborIds.has(n.id) ? 1 : 0.2);
      linkSel.attr('opacity', l =>
        (l.source as GraphNode).id === d.id || (l.target as GraphNode).id === d.id ? 1 : 0.04
      );
      this.zone.run(() => this.tooltip.set({
        name:           d.name,
        scientificName: d.scientificName,
        family:         d.family,
        count:          d.occurrenceCount,
        photo:          d.photo,
      }));
    });

    nodeSel.on('mouseleave', () => {
      nodeSel.attr('fill-opacity', 0.82).attr('stroke-opacity', 1);
      linkSel.attr('opacity', 1);
      this.zone.run(() => this.tooltip.set(null));
    });

    nodeSel.on('click', (_e: MouseEvent, d: GraphNode) => {
      this.zone.run(() => this.router.navigate(['/species', d.id]));
    });

    // ─── Drag ─────────────────────────────────────────────────────────────────
    this.zone.runOutsideAngular(() => {
      nodeSel.call(
        d3.drag<SVGCircleElement, GraphNode>()
          .on('start', (e, d) => {
            if (!e.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end',   (e, d) => {
            if (!e.active) sim.alphaTarget(0);
            d.fx = null; d.fy = null;
          }),
      );
    });

    // ─── Simulation ───────────────────────────────────────────────────────────
    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id(d => d.id)
        .strength(d => d.strength)
        .distance(d => d.rank === 'genus' ? 50 : 110),
      )
      .force('charge',  d3.forceManyBody<GraphNode>().strength(d => -Math.pow(d.r, 1.8) * 1.2))
      .force('collide', d3.forceCollide<GraphNode>().radius(d => d.r + 3).strength(0.85))
      .force('center',  d3.forceCenter(w / 2, h / 2).strength(0.2))
      .stop(); // stop before rAF fires so we can pre-run synchronously

    // Pre-run 150 ticks to get a stable bbox before the user can interact
    sim.tick(150);
    this.applyZoomConstraints(nodes, zoom, w, h);

    // Resume animation from partially-settled state
    this.zone.runOutsideAngular(() => {
      sim.on('tick', () => {
        linkSel
          .attr('x1', d => (d.source as GraphNode).x!)
          .attr('y1', d => (d.source as GraphNode).y!)
          .attr('x2', d => (d.target as GraphNode).x!)
          .attr('y2', d => (d.target as GraphNode).y!);
        nodeSel
          .attr('cx', d => d.x!)
          .attr('cy', d => d.y!);
      });

      // Refine constraints once fully settled
      sim.on('end.constraints', () => {
        if (!sig.aborted) this.applyZoomConstraints(nodes, zoom, w, h);
      });

      sim.alpha(0.5).restart();
    });

    sig.addEventListener('abort', () => sim.stop());

    // Entrance fade-in
    g.attr('opacity', 0).transition().duration(700).ease(d3.easeCubicOut).attr('opacity', 1);
  }

  private applyZoomConstraints(
    nodes: GraphNode[],
    zoom: ZoomBehavior<SVGSVGElement, unknown>,
    w: number,
    h: number,
  ): void {
    const pad = 60;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, (n.x ?? 0) - n.r);
      maxX = Math.max(maxX, (n.x ?? 0) + n.r);
      minY = Math.min(minY, (n.y ?? 0) - n.r);
      maxY = Math.max(maxY, (n.y ?? 0) + n.r);
    }
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const fitScale = Math.min(w / (maxX - minX), h / (maxY - minY));
    zoom.scaleExtent([fitScale, 5]).translateExtent([[minX, minY], [maxX, maxY]]);
  }

  private buildLinks(nodes: GraphNode[]): GraphLink[] {
    const links:  GraphLink[] = [];
    const linked = new Set<string>();

    const addLink = (a: GraphNode, b: GraphNode, rank: 'genus' | 'family', strength: number) => {
      const key = `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`;
      if (linked.has(key)) return;
      linked.add(key);
      links.push({ source: a, target: b, strength, rank });
    };

    const linkGroup = (
      group: GraphNode[],
      rank: 'genus' | 'family',
      strength: number,
      maxSize: number,
    ) => {
      const g = group.length > maxSize
        ? [...group].sort((a, b) => b.occurrenceCount - a.occurrenceCount).slice(0, maxSize)
        : group;
      for (let i = 0; i < g.length - 1; i++) {
        for (let j = i + 1; j < g.length; j++) {
          addLink(g[i], g[j], rank, strength);
        }
      }
    };

    const byGenus  = new Map<string, GraphNode[]>();
    const byFamily = new Map<string, GraphNode[]>();

    for (const n of nodes) {
      if (n.genus)  { (byGenus.get(n.genus)   ?? (byGenus.set(n.genus, []),   byGenus.get(n.genus)!)).push(n); }
      if (n.family) { (byFamily.get(n.family)  ?? (byFamily.set(n.family, []), byFamily.get(n.family)!)).push(n); }
    }

    for (const [, g] of byGenus)  linkGroup(g, 'genus',  0.9, 12);
    for (const [, g] of byFamily) linkGroup(g, 'family', 0.4,  6);

    return links;
  }
}
