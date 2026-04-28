export interface SpeciesPhoto {
  url: string;
  credit?: string;
  license?: string;
}

export interface SpeciesObservation {
  lat: number;
  lon: number;
  month?: number;
  year?: number;
  date?: string;
  photoUrl?: string;
}

export interface Species {
  taxonKey: number;
  scientificName: string;
  vernacularName: string;        // common name in English
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;

  occurrenceCount: number;
  observations: SpeciesObservation[];
  representativePhoto: SpeciesPhoto | null;

  // Enriched lazily (iNaturalist / Wikipedia)
  inatTaxonId?: number;
  inatPhoto?: SpeciesPhoto;
  wikipediaSummary?: string;
  wikipediaUrl?: string;
}
