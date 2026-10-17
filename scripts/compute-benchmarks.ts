// Counts named OSM businesses by category in each demo city and divides by the city's population,
// to produce the tables in src/lib/analysis/benchmarks.ts. Paste the printed block into that file.
//
//   npx tsx scripts/compute-benchmarks.ts

import { CATEGORY_IDS } from "../src/lib/ingest/categories";
import { businessQuery, countByCategory, runOverpass } from "./lib/osm";

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

async function main() {
  console.log(`Queried ${new Date().toISOString()}\n`);
  for (const city of CITIES) {
    // Overpass area ids are the relation id plus 3,600,000,000.
    const setup = `area(id:${3_600_000_000 + city.osmRelation})->.city;`;
    const elements = await runOverpass(businessQuery(setup, "(area.city)", 300), 330_000);
    const counts = countByCategory(elements);
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
