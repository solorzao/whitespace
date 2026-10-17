// Overpass helpers for the scripts. The app's live circle query is Kevin's, in src/lib/ingest.

import { OSM_TAGS, categorizeOsm, emptyCounts, type CategoryId } from "../../src/lib/ingest/categories";
import { errorMessage, fetchWithRetry } from "../../src/lib/ingest/http";

// The main instance first, then one mirror.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export const USER_AGENT = "whitespace-hackathon/0.1 (gap benchmarks; https://github.com/solorzao/whitespace)";

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
};

// Named shop, amenity and leisure elements whose value maps to a category, within `scope`,
// an Overpass filter such as "(area.city)" or "(around:800,34.0195,-118.4912)".
// Elements with unmapped values would be dropped by categorizeOsm anyway, so filtering them
// on the server only makes the response smaller.
export function businessQuery(setup: string, scope: string, timeoutS: number): string {
  const clauses = Object.entries(OSM_TAGS).map(([key, map]) => {
    const values = Object.keys(map);
    if (key === "leisure") values.push("sports_centre"); // fitness only with certain sports, see categorizeOsm
    return `nwr["${key}"~"^(${values.join("|")})$"]["name"]${scope};`;
  });
  return `[out:json][timeout:${timeoutS}];${setup}(${clauses.join("")});out tags;`;
}

// overpass-api.de answers 502 when all its workers are busy, so the scripts go through
// both hosts a few times with a growing wait in between.
const BACKOFF_S = [0, 20, 60];

export async function runOverpass(query: string, timeoutMs: number): Promise<OsmElement[]> {
  let lastError: unknown;
  for (const waitS of BACKOFF_S) {
    if (waitS > 0) {
      console.warn(`Waiting ${waitS} s before trying again`);
      await new Promise((r) => setTimeout(r, waitS * 1000));
    }
    for (const url of OVERPASS_URLS) {
      try {
        const res = await fetchWithRetry(url, {
          method: "POST",
          body: new URLSearchParams({ data: query }),
          headers: { "User-Agent": USER_AGENT },
          timeoutMs,
          retries: 0,
        });
        const json = (await res.json()) as { elements: OsmElement[]; remark?: string };
        // Overpass reports a query timeout as a 200 with partial results and a remark.
        if (json.remark) throw new Error(`Overpass: ${json.remark}`);
        return json.elements;
      } catch (err) {
        console.warn(`${new URL(url).host} failed: ${errorMessage(err)}`);
        lastError = err;
      }
    }
  }
  throw lastError;
}

export function countByCategory(elements: OsmElement[]): Record<CategoryId, number> {
  const counts = emptyCounts();
  for (const el of elements) {
    const category = categorizeOsm(el.tags ?? {});
    if (category) counts[category]++;
  }
  return counts;
}
