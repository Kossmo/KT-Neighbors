import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Species } from '../../core/models/species.model';
import { SpeciesStore } from '../../core/services/species-store';

interface TreeNode {
  id: number;
  name: string;
  rank?: string;
  isLeaf?: boolean;
  taxonKey?: number;
  scientificName?: string;
  occurrenceCount?: number;
  children?: TreeNode[];
}

const KINGDOM_COLORS: Record<string, string> = {
  Animalia:  '#c4873a',
  Plantae:   '#5c7a4e',
  Fungi:     '#a85050',
  Chromista: '#4a6a7a',
  Protozoa:  '#a08070',
};

const COL_WIDTH  = 190;
const ROW_HEIGHT = 20;

@Component({
  selector: 'app-tree',
  templateUrl: './tree.component.html',
  styleUrl: './tree.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeComponent implements AfterViewInit, OnDestroy {
  private readonly store  = inject(SpeciesStore);
  private readonly router = inject(Router);
  private readonly zone   = inject(NgZone);

  private readonly svgElRef  = viewChild.required<ElementRef<SVGSVGElement>>('svgEl');
  private readonly wrapElRef = viewChild.required<ElementRef<HTMLDivElement>>('wrapEl');

  // AbortController to clean up all event listeners on destroy
  private readonly abort = new AbortController();

  readonly locationName = this.store.locationName;
  readonly speciesCount = computed(() => this.store.species().length);

  async ngAfterViewInit(): Promise<void> {
    const species = this.store.species();
    if (!species.length) { this.router.navigate(['/']); return; }
    await this.render(species);
  }

  ngOnDestroy(): void {
    this.abort.abort();
  }

  goBack(): void {
    const coords = this.store.coordinates();
    if (coords) this.router.navigate(['/discovery'], { queryParams: { lat: coords.lat, lon: coords.lon } });
    else         this.router.navigate(['/']);
  }

  // ─── Hierarchy builder ───────────────────────────────────────────────────────
  private buildHierarchy(species: Species[]): TreeNode {
    let id = 0;
    const root: TreeNode = { id: id++, name: 'Life', rank: 'root', children: [] };

    for (const sp of species) {
      if (!sp.kingdom || !sp.phylum || !sp.class || !sp.order || !sp.family || !sp.genus) continue;

      const ranks = [
        { rank: 'kingdom', name: sp.kingdom },
        { rank: 'phylum',  name: sp.phylum  },
        { rank: 'class',   name: sp.class   },
        { rank: 'order',   name: sp.order   },
        { rank: 'family',  name: sp.family  },
        { rank: 'genus',   name: sp.genus   },
      ];
      let node = root;
      for (const { rank, name } of ranks) {
        let child = node.children!.find(c => c.name === name && c.rank === rank);
        if (!child) {
          child = { id: id++, name, rank, children: [] };
          node.children!.push(child);
        }
        node = child;
      }
      node.children!.push({
        id: id++,
        name: sp.vernacularName || sp.scientificName,
        scientificName: sp.scientificName,
        taxonKey: sp.taxonKey,
        occurrenceCount: sp.occurrenceCount,
        isLeaf: true,
      });
    }
    return root;
  }

  // ─── D3 render ───────────────────────────────────────────────────────────────
  private async render(species: Species[]): Promise<void> {
    const d3    = await import('d3');
    const wrap  = this.wrapElRef().nativeElement;
    const svgEl = this.svgElRef().nativeElement;
    const w     = wrap.clientWidth;
    const h     = wrap.clientHeight;

    const data = this.buildHierarchy(species);
    const root = d3.hierarchy<TreeNode>(data, d => d.children?.length ? d.children : undefined) as any;
    const nodes = root.descendants();

    const expandedNodes = this.store.treeExpandedNodes();
    nodes.forEach((d: any) => {
      if (d.depth >= 3 && d.children) {
        d._children = d.children;
        d.children  = null;
        if (expandedNodes.has(`${d.data.rank}:${d.data.name}`)) {
          d.children  = d._children;
          d._children = null;
        }
      }
    });
    

    const layout = d3.tree<TreeNode>().nodeSize([ROW_HEIGHT, COL_WIDTH]);

    const svg = d3.select<SVGSVGElement, unknown>(svgEl)
      .attr('width', w)
      .attr('height', h);

    const g         = svg.append('g');
    const linkGroup = g.append('g').attr('class', 'links');
    const nodeGroup = g.append('g').attr('class', 'nodes');

    // ─── Pan / zoom state ─────────────────────────────────────────────────────
    const labelPad = 160;
    const buf      = 80;

    // Minimum pixels of the tree that must remain visible when panning (per axis)
    const panMinX  = Math.round(w / 3);
    const panMinY  = Math.round(h / 3);

    let boundsMinX = 0, boundsMaxX = 1, boundsMaxY = COL_WIDTH;
    let curK = 1, curTx = buf, curTy = h / 2;

    // Clamp functions read curK and bounds from closure — always up-to-date
    const clampTx = (tx: number) =>
      Math.max(panMinX - (boundsMaxY + labelPad) * curK, Math.min(w - panMinX, tx));
    const clampTy = (ty: number) =>
      Math.max(panMinY - boundsMaxX * curK, Math.min(h - panMinY - boundsMinX * curK, ty));

    const applyTransform = () =>
      g.attr('transform', `translate(${curTx},${curTy}) scale(${curK})`);

    // ─── Native pointer events for pan ────────────────────────────────────────
    // Delta-based approach: accumulate clamped deltas, never unclamped state.
    this.zone.runOutsideAngular(() => {
      const sig: AbortSignal = this.abort.signal;
      let isDragging = false;
      let startClientX = 0, startClientY = 0;
      let lastPX = 0, lastPY = 0;

      svgEl.addEventListener('pointerdown', (e: PointerEvent) => {
        isDragging    = true;
        startClientX  = lastPX = e.clientX;
        startClientY  = lastPY = e.clientY;
      }, { signal: sig });

      svgEl.addEventListener('pointermove', (e: PointerEvent) => {
        if (!isDragging) return;
        // Apply clamped delta — no accumulated unclamped state
        curTx = clampTx(curTx + (e.clientX - lastPX));
        curTy = clampTy(curTy + (e.clientY - lastPY));
        lastPX = e.clientX;
        lastPY = e.clientY;
        applyTransform();
      }, { signal: sig });

      const stopDrag = () => { isDragging = false; };
      svgEl.addEventListener('pointerup',    stopDrag, { signal: sig });
      svgEl.addEventListener('pointerleave', stopDrag, { signal: sig });

      // Suppress node clicks that follow a drag (> 3 px movement), capture phase
      svgEl.addEventListener('click', (e: MouseEvent) => {
        const dx = e.clientX - startClientX;
        const dy = e.clientY - startClientY;
        if (dx * dx + dy * dy > 9) e.stopPropagation();
      }, { capture: true, signal: sig });

      // Wheel zoom toward pointer
      svgEl.addEventListener('wheel', (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newK   = Math.max(0.1, Math.min(4, curK * factor));

        // Keep the data point under the cursor fixed after rescaling
        const rect  = svgEl.getBoundingClientRect();
        const px    = e.clientX - rect.left;
        const py    = e.clientY - rect.top;
        const dataX = (px - curTx) / curK;
        const dataY = (py - curTy) / curK;

        curK  = newK;
        curTx = clampTx(px - dataX * curK);
        curTy = clampTy(py - dataY * curK);
        applyTransform();
      }, { passive: false, signal: sig });
    });

    // ─── D3 links & nodes ─────────────────────────────────────────────────────
    const linkGen = d3.linkHorizontal<any, any>()
      .x((d: any) => d.y)
      .y((d: any) => d.x);

    const nodeColor = (d: any): string => {
      if (d.data.isLeaf) return '#8aaa7c';
      if (d._children)   return '#c4873a';
      if (d.depth === 1) return KINGDOM_COLORS[d.data.name] ?? '#a08070';
      return '#c8b8a4';
    };

    const nodeLabel = (d: any): string =>
      d._children ? `${d.data.name} (${d._children.length})` : d.data.name;

    const recomputeBounds = () => {
      const ns: any[] = root.descendants().filter((d: any) => d.depth > 0);
      if (!ns.length) return;
      boundsMinX = Math.min(...ns.map((d: any) => d.x));
      boundsMaxX = Math.max(...ns.map((d: any) => d.x));
      boundsMaxY = Math.max(...ns.map((d: any) => d.y));
    };

    const update = (_src: any) => {
      layout(root);
      recomputeBounds();

      const nodes: any[] = root.descendants().filter((d: any) => d.depth > 0);
      const links: any[] = root.links().filter((d: any) => d.source.depth > 0);

      // ── Links ──────────────────────────────────────────────────────────────
      const linkSel = linkGroup.selectAll<SVGPathElement, any>('path.link')
        .data(links, (d: any) => d.target.data.id);

      linkSel.exit().transition().duration(280).attr('opacity', 0).remove();
      linkSel.transition().duration(320).attr('d', linkGen);
      linkSel.enter().append('path')
        .attr('class', 'link')
        .attr('fill', 'none')
        .attr('stroke', '#ddd5c8')
        .attr('stroke-width', 1)
        .attr('d', linkGen)
        .attr('opacity', 0)
        .transition().duration(320).attr('opacity', 1);

      // ── Nodes ──────────────────────────────────────────────────────────────
      const nodeSel = nodeGroup.selectAll<SVGGElement, any>('g.node')
        .data(nodes, (d: any) => d.data.id);

      nodeSel.exit().transition().duration(250).attr('opacity', 0).remove();

      nodeSel.transition().duration(320)
        .attr('transform', (d: any) => `translate(${d.y},${d.x})`)
        .attr('opacity', 1);

      nodeSel.select<SVGCircleElement>('circle').transition().duration(320)
        .attr('r', (d: any) => d._children ? 5.5 : d.data.isLeaf ? 3.5 : 4.5)
        .attr('fill', nodeColor);

      nodeSel.select<SVGTextElement>('text').text(nodeLabel);

      const nodeEnter = nodeSel.enter().append('g')
        .attr('class', 'node')
        .attr('transform', (d: any) => `translate(${d.y},${d.x})`)
        .attr('opacity', 0)
        .style('cursor', (d: any) => d.data.isLeaf || d.children || d._children ? 'pointer' : 'default');

      nodeEnter.append('circle')
        .attr('r', (d: any) => d._children ? 5.5 : d.data.isLeaf ? 3.5 : 4.5)
        .attr('fill', nodeColor)
        .attr('stroke', '#f4ede0')
        .attr('stroke-width', 1.5);

      nodeEnter.append('text')
        .attr('dy', '0.35em')
        .attr('x', 10)
        .attr('font-size', (d: any) => d.depth === 1 ? '13px' : d.data.isLeaf ? '9px' : '10px')
        .attr('font-family', 'Lora, Georgia, serif')
        .attr('font-style', (d: any) => d.data.isLeaf ? 'italic' : 'normal')
        .attr('font-weight', (d: any) => d.depth === 1 ? '500' : 'normal')
        .attr('fill', (d: any) => d.data.isLeaf ? '#6b5744' : '#3a2f24')
        .attr('stroke', '#f4ede0')
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .style('paint-order', 'stroke fill')
        .text(nodeLabel);

      nodeEnter.on('click', (event: MouseEvent, d: any) => {
        event.stopPropagation();
        if (d.data.isLeaf) {
          this.zone.run(() => this.router.navigate(['/species', d.data.taxonKey]));
        } else {
          const key = `${d.data.rank}:${d.data.name}`;
          if (d.children) {
            d._children = d.children;
            d.children  = null;
            this.store.treeExpandedNodes.update(s => { const n = new Set(s); n.delete(key); return n; });
          } else {
            d.children  = d._children;
            d._children = null;
            this.store.treeExpandedNodes.update(s => new Set([...s, key]));
          }
          update(d);
        }
      });

      nodeEnter.transition().duration(320).attr('opacity', 1);
    };

    update(root);

    // ─── Initial fit transform ────────────────────────────────────────────────
    const k = Math.min(
      (w - 2 * buf) / (boundsMaxY + labelPad),
      (h - 2 * buf) / Math.max(boundsMaxX - boundsMinX, 1),
      1,
    );
    curK  = k;
    curTx = clampTx(buf);
    curTy = clampTy(h / 2 - ((boundsMinX + boundsMaxX) / 2) * k);

    // Entrance zoom: start zoomed-out from the tree center, ease into fit
    const cxData  = (boundsMaxY + labelPad) / 2;
    const cyData  = (boundsMinX + boundsMaxX) / 2;
    const startK  = k * 0.3;
    g.attr('opacity', 0)
     .attr('transform', `translate(${curTx + cxData * (k - startK)},${curTy + cyData * (k - startK)}) scale(${startK})`);
    g.transition()
      .duration(750)
      .ease(d3.easeCubicOut)
      .attr('opacity', 1)
      .attr('transform', `translate(${curTx},${curTy}) scale(${k})`);
  }
}
