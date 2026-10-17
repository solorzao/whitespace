// Google Places competitors within 2 km for one concept category, with their reviews, for the success
// profile and the gap type rules in ANALYSIS_PLAN.md. /api/analyze calls this after scoring the gaps,
// so it isn't part of collectArea.

import type { Business, CategoryId, LatLng, SourceDoc } from "../types";
import { googleTypesFor } from "./categories";
import { AREA_RADIUS_M, findDemoArea } from "./demo-areas";
import { distanceM } from "./geo";
import { findDuplicate, parsePlace, placeDoc, placesKey, reviewDocs, searchNearby, type Parsed } from "./places";
import { settle, type AdapterResult } from "./result";
import { competitorsFilePath, readSaved } from "./saved";

export const COMPETITOR_RADIUS_M = 2000;

export type CompetitorsData = {
  category: CategoryId;
  center: LatLng;
  radiusM: number;
  businesses: Business[]; // most popular first, as Google ranks them
};

// What ingest-demo.ts saves next to each demo area, for every category.
export type SavedCompetitors = Partial<Record<CategoryId, CompetitorsData & { docs: SourceDoc[] }>>;

const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

// One billed call (Nearby Search, Enterprise + Atmosphere): up to 20 competitors ranked by popularity,
// each with up to 5 reviews, price level, hours and service options. The search is by primary type,
// so the 20 results are businesses of this category rather than places that merely list one of its
// types, such as furniture stores tagged home_improvement_store under hardware.
export async function fetchCompetitors(
  category: CategoryId,
  center: LatLng,
  radiusM = COMPETITOR_RADIUS_M,
): Promise<{ docs: SourceDoc[]; data: CompetitorsData }> {
  const places = await searchNearby(
    { ...center, radiusM, includedPrimaryTypes: googleTypesFor(category), withAtmosphere: true },
    placesKey(),
  );
  const parsed = places.map(parsePlace).filter((p): p is Parsed => p !== null && p.business.category === category);
  const docs: SourceDoc[] = [];
  for (const p of parsed) {
    const d = distanceM(center, p.business);
    const where = d <= AREA_RADIUS_M ? "inside" : "outside";
    docs.push(placeDoc(p, `It is ${formatDistance(d)} from the pin, ${where} the ${AREA_RADIUS_M} m area.`));
  }
  for (const p of parsed) docs.push(...reviewDocs(p.business, p.reviews));
  return { docs, data: { category, center, radiusM, businesses: parsed.map((p) => p.business) } };
}

export type CompetitorsOptions = {
  live?: boolean; // skip the saved demo data
};

// Competitors for one category. Near a demo center this returns the saved data (same 300 m snap as
// collectArea), so the demo makes no live calls; elsewhere it needs PLACES_LIVE=1. Never throws.
export function collectCompetitors(
  category: CategoryId,
  lat: number,
  lng: number,
  radiusM = COMPETITOR_RADIUS_M,
  options: CompetitorsOptions = {},
): Promise<AdapterResult<CompetitorsData>> {
  return settle<CompetitorsData>(async () => {
    const demo = options.live ? null : findDemoArea({ lat, lng });
    if (demo) {
      const saved = (await readSaved<SavedCompetitors>(competitorsFilePath(demo)))?.[category];
      if (saved && saved.radiusM === radiusM) {
        const { docs, ...data } = saved;
        return { docs, data };
      }
      return fetchCompetitors(category, demo.center, radiusM);
    }
    return fetchCompetitors(category, { lat, lng }, radiusM);
  });
}

// For AnalyzeResponse.competitors: the competitors that aren't already in the circle's businesses,
// matched by Places id or by name within 50 m of an OSM business. The gap type rules and success
// profile should still use the full list.
export function competitorsNotOnMap(businesses: Business[], competitors: Business[]): Business[] {
  return competitors.filter((c) => !findDuplicate(businesses, c));
}
