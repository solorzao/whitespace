// Businesses per 1,000 residents in each demo city, by category. The circle counts and these
// benchmarks both come from OpenStreetMap, so OSM's uneven coverage mostly cancels out.
//
// Produced by scripts/compute-benchmarks.ts on 2026-10-17 (20:24 UTC, overpass-api.de):
// - Counts: named nodes, ways and relations tagged shop, amenity or leisure inside the city
//   boundary, mapped with categorizeOsm like the circle counts. The comment on each line is the count.
//   Santa Monica city: OSM relation 3353288, 785 businesses.
//   New York County (Manhattan): OSM relation 2552485, 13,226 businesses.
// - Populations: 2020 Census counts (POP100) from TIGERweb tigerWMS_Census2020:
//   Santa Monica city 93,076 (place 0670000); New York County 1,694,251 (county 36061).
//   The circle uses ACS 2020–2024 estimates, but the Census API needs a key the script didn't have.
//   The two differ by a few percent, which is well inside OSM's own noise.

import type { CategoryId, LatLng } from "../types";
import { CATEGORY_IDS } from "../ingest/categories";
import { findDemoArea } from "../ingest/demo-areas";

export type Benchmark = {
  slug: string;
  name: string;
  per1k: Record<CategoryId, number>;
};

export const BENCHMARKS = {
  "santa-monica": {
    slug: "santa-monica",
    name: "Santa Monica city, CA",
    per1k: {
      grocery: 0.183, // 17
      specialty_food: 0.075, // 7
      convenience: 0.129, // 12
      bakery: 0.129, // 12
      restaurant: 2.009, // 187
      fast_food: 0.999, // 93
      cafe: 0.892, // 83
      bar: 0.322, // 30
      liquor: 0.15, // 14
      pharmacy: 0.215, // 20
      medical: 0.87, // 81
      laundry: 0.097, // 9
      hair_beauty: 0.602, // 56
      fitness: 0.344, // 32
      childcare: 0.129, // 12
      pet: 0.204, // 19
      clothing: 0.655, // 61
      hardware: 0.097, // 9
      bank: 0.279, // 26
      books: 0.054, // 5
    },
  },
  "lower-manhattan": {
    slug: "lower-manhattan",
    name: "New York County (Manhattan), NY",
    per1k: {
      grocery: 0.152, // 257
      specialty_food: 0.171, // 290
      convenience: 0.358, // 607
      bakery: 0.14, // 237
      restaurant: 2.049, // 3472
      fast_food: 1.009, // 1709
      cafe: 0.752, // 1274
      bar: 0.542, // 919
      liquor: 0.163, // 277
      pharmacy: 0.194, // 328
      medical: 0.309, // 524
      laundry: 0.211, // 358
      hair_beauty: 0.583, // 988
      fitness: 0.141, // 239
      childcare: 0.032, // 55
      pet: 0.085, // 144
      clothing: 0.566, // 959
      hardware: 0.052, // 88
      bank: 0.254, // 430
      books: 0.042, // 71
    },
  },
} satisfies Record<string, Benchmark>;

// For pins outside the demo areas: the plain average of the two cities.
export const DEFAULT_BENCHMARK: Benchmark = {
  slug: "default",
  name: "Average of Santa Monica and Manhattan",
  per1k: Object.fromEntries(
    CATEGORY_IDS.map((id) => [
      id,
      (BENCHMARKS["santa-monica"].per1k[id] + BENCHMARKS["lower-manhattan"].per1k[id]) / 2,
    ]),
  ) as Record<CategoryId, number>,
};

// A pin that snaps to a demo area uses its city's table; any other pin uses the default.
export function benchmarkFor(point: LatLng): Benchmark {
  const area = findDemoArea(point);
  if (area && area.slug in BENCHMARKS) return BENCHMARKS[area.slug as keyof typeof BENCHMARKS];
  return DEFAULT_BENCHMARK;
}
