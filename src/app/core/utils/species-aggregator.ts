import { GbifOccurrence } from '../models/occurrence.model';
import { Species, SpeciesObservation, SpeciesPhoto } from '../models/species.model';

export function aggregateOccurrences(occurrences: GbifOccurrence[]): Species[] {
  const map = new Map<number, Species>();

  for (const occ of occurrences) {
    const key = occ.speciesKey ?? occ.taxonKey;
    if (!key || occ.decimalLatitude == null || occ.decimalLongitude == null) continue;

    const photoUrl = occ.media?.[0]?.identifier ?? undefined;
    const observation: SpeciesObservation = {
      lat: occ.decimalLatitude,
      lon: occ.decimalLongitude,
      month: occ.month,
      year: occ.year,
      date: occ.eventDate,
      photoUrl,
    };

    if (map.has(key)) {
      const existing = map.get(key)!;
      existing.occurrenceCount++;
      existing.observations.push(observation);
      // Prefer observation with a photo as representative
      if (!existing.representativePhoto && photoUrl) {
        existing.representativePhoto = buildPhoto(occ);
      }
    } else {
      map.set(key, {
        taxonKey: key,
        scientificName: occ.species ?? occ.scientificName,
        vernacularName: occ.vernacularName ?? '',
        kingdom: occ.kingdom ?? '',
        phylum: occ.phylum ?? '',
        class: occ.class ?? '',
        order: occ.order ?? '',
        family: occ.family ?? '',
        genus: occ.genus ?? '',
        occurrenceCount: 1,
        observations: [observation],
        representativePhoto: photoUrl ? buildPhoto(occ) : null,
      });
    }
  }

  // Sort by occurrence count descending (most-observed species first)
  return Array.from(map.values()).sort((a, b) => b.occurrenceCount - a.occurrenceCount);
}

function buildPhoto(occ: GbifOccurrence): SpeciesPhoto | null {
  const media = occ.media?.[0];
  if (!media?.identifier) return null;
  return {
    url: media.identifier,
    credit: media.creator,
    license: media.license,
  };
}
