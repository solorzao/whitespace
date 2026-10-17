// Counts named OSM businesses by category in each demo city and divides by the city's population,
// to produce the tables in src/lib/analysis/benchmarks.ts. Paste the printed block into that file.
//
//   npx tsx scripts/compute-benchmarks.ts

import { CATEGORY_IDS, OSM_TAGS, categorizeOsm, emptyCounts } from "../src/lib/ingest/categories";
import { errorMessage, fetchWithRetry } from "../src/lib/ingest/http";
import { USER_AGENT } from "../src/lib/ingest/result";

// Populations are 2020 Census counts (POP100), from TIGERweb's tigerWMS_Census2020 service:
// layer 26 (Incorporated Places) GEOID 0670000, and layer 82 (Counties) GEOID 36061.
// The ACS 2020–2024 estimates would match the circle demographics, but the Census API needs a key.
const CITIES = [
  {
    slug: "santa-monica",
    name: "Santa Monica city, CA",
    osmRelation: 3353288, // boundary=administrative, admin_level=8, wikidata Q47164
    population: 93_076,
  },
  {
    slug: "lower-manhattan",
    name: "New York County (Manhattan), NY",
    osmRelation: 2552485, // boundary=administrative, admin_level=6, wikidata Q500416
    population: 1_694_251,
  },
];

// The main instance first, then one mirror.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// overpass-api.de answers 429 or 502 when its workers are busy, so go through both hosts
// a few times with a growing wait in between.
const BACKOFF_S = [0, 20, 60];

type OsmElement = { type: "node" | "way" | "relation"; id: number; tags?: Record<string, string> };

// The same filter as the circle query in src/lib/ingest/overpass.ts, over a whole city. Elements
// with unmapped values would be dropped by categorizeOsm anyway, so leaving them out on the
// server only makes the response smaller.
function cityQuery(osmRelation: number): string {
  const clauses = Object.entries(OSM_TAGS).map(([key, map]) => {
    const values = Object.keys(map);
    if (key === "leisure") values.push("sports_centre"); // fitness only with certain sports, see categorizeOsm
    return `nwr(area.city)[name]["${key}"~"^(${values.join("|")})$"];`;
  });
  // Overpass area ids are the relation id plus 3,600,000,000.
  return `[out:json][timeout:300];area(id:${3_600_000_000 + osmRelation})->.city;(${clauses.join("")});out tags;`;
}

async function runOverpass(query: string): Promise<OsmElement[]> {
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
          timeoutMs: 330_000,
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

async function main() {
  console.log(`Queried ${new Date().toISOString()}\n`);
  for (const city of CITIES) {
    const elements = await runOverpass(cityQuery(city.osmRelation));
    const counts = emptyCounts();
    for (const el of elements) {
      const category = categorizeOsm(el.tags ?? {});
      if (category) counts[category]++;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`// ${city.name}: ${elements.length} elements, ${total} categorized, population ${city.population}`);
    console.log(`  "${city.slug}": {`);
    for (const id of CATEGORY_IDS) {
      const per1k = counts[id] / (city.population / 1000);
      console.log(`    ${id}: ${per1k.toFixed(3)}, // ${counts[id]}`);
    }
    console.log("  },\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
