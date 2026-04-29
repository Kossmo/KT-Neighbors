export interface GbifMedia {
  type: string;
  identifier: string;       // image URL
  title?: string;
  creator?: string;
  license?: string;
}

export interface GbifOccurrence {
  key: number;
  gbifID: string;
  taxonKey: number;
  speciesKey?: number;
  scientificName: string;
  vernacularName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  decimalLatitude: number;
  decimalLongitude: number;
  eventDate?: string;
  year?: number;
  month?: number;
  basisOfRecord: string;
  media: GbifMedia[];
  mediaType?: string[];
}

export interface GbifFacetCount {
  name: string;
  count: number;
}

export interface GbifFacet {
  field: string;
  counts: GbifFacetCount[];
}

export interface GbifSearchResponse {
  offset: number;
  limit: number;
  endOfRecords: boolean;
  count: number;
  results: GbifOccurrence[];
  facets?: GbifFacet[];
}
