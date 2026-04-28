export type TaxonomicRank =
  | 'kingdom'
  | 'phylum'
  | 'class'
  | 'order'
  | 'family'
  | 'genus'
  | 'species';

export interface TaxonNode {
  name: string;
  rank: TaxonomicRank;
  children: TaxonNode[];
  taxonKey?: number;       // present only at species level
}

export const KINGDOM_ORDER: Record<string, number> = {
  Animalia: 0,
  Plantae: 1,
  Fungi: 2,
  Chromista: 3,
  Protozoa: 4,
  Bacteria: 5,
  Archaea: 6,
};
