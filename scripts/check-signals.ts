// Checks the card signals in src/lib/analysis/signals.ts on a hand-written area, then prints them as card
// lines for the top 3 gap categories of both demo areas. The demo areas come from data/demo/, so no API
// keys are needed. The saved data has no permanently closed businesses, so the closure rules are
// checked on the hand-written area only.
//
//   npx tsx scripts/check-signals.ts
//   npx tsx scripts/check-signals.ts --all     every scored category, not only the top 3

import assert from "node:assert/strict";
import type { AreaData, Business, SourceDoc } from "../src/lib/types";
import { DEMO_AREAS, collectArea, collectCompetitors } from "../src/lib/ingest/index";
import { benchmarkFor } from "../src/lib/analysis/benchmarks";
import { scoreGaps } from "../src/lib/analysis/gap-score";
import {
  evidenceLine,
  evidenceSize,
  nearestAndClosures,
  nearestLine,
  priceLine,
  priceMix,
  type CompetitorSet,
} from "../src/lib/analysis/signals";

const CENTER = DEMO_AREAS[0].center;
const M_PER_DEG_LAT = 111_195;

// A business `northM` meters north of the center.
function business(id: string, category: Business["category"], northM: number, extra: Partial<Business> = {}): Business {
  return { id, name: id, category, lat: CENTER.lat + northM / M_PER_DEG_LAT, lng: CENTER.lng, url: "", ...extra };
}

const review = (id: string, category: Business["category"]): SourceDoc => ({
  id,
  source: "review",
  url: "",
  title: "",
  text: "",
  category,
});

function checkSample() {
  // In the circle: a laundromat that closed for good (OSM merged with places:A), one closed for now, and a café.
  const circle: Business[] = [
    business("osm:node/1", "laundry", 100, { status: "closed_permanently", docIds: ["osm:node/1", "places:A"] }),
    business("places:B", "laundry", 300, { status: "closed_temporarily" }),
    business("osm:node/2", "cafe", 50),
  ];
  // Within 2 km: the same two again, one open 1.4 km away and one more closed for good.
  const competitors: Business[] = [
    business("places:A", "laundry", 100, { status: "closed_permanently" }),
    business("places:B", "laundry", 300, { status: "closed_temporarily" }),
    business("places:C", "laundry", 1400, { status: "open" }),
    business("places:D", "laundry", 1800, { status: "closed_permanently" }),
  ];
  const area: Pick<AreaData, "center" | "radiusM" | "businesses" | "demographics" | "docs"> = {
    center: CENTER,
    radiusM: 800,
    businesses: circle,
    demographics: {
      tractFips: ["1", "2", "3"],
      population: 9000,
      medianIncome: 160_000,
      medianAge: null,
      medianRent: null,
      pctRenters: null,
      pctWithKids: null,
      pctNoVehicle: null,
    },
    docs: [review("review:A:0", "laundry"), review("review:A:1", "laundry"), review("review:X:0", "cafe")],
  };
  const set: CompetitorSet = { businesses: competitors, docs: [review("review:A:0", "laundry"), review("review:C:0", "laundry")] };

  const n = nearestAndClosures("laundry", area, competitors);
  assert.equal(n.openInCircle, 0, "closed businesses aren't open");
  assert.equal(n.closedForGood, 2, "places:A is in both lists but counts once");
  assert.equal(n.closedTemporarily, 1, "temporary closures are counted apart");
  assert.equal(n.nearest?.id, "places:C");
  assert.equal(nearestLine(n), "No laundromat in the circle. The nearest is 1.4 km away, and 2 nearby have closed for good.");
  assert.equal(nearestLine(nearestAndClosures("laundry", area, null)), "No laundromat in the circle. 1 nearby has closed for good.");
  assert.equal(nearestLine(nearestAndClosures("cafe", area, [])), "1 café in the circle. The nearest is 50 m away.");
  const offMap = nearestAndClosures("cafe", area, [business("places:F", "cafe", 600), business("places:G", "cafe", 900)]);
  assert.deepEqual([offMap.openOnMap, offMap.openInCircle], [1, 2], "a competitor inside the circle counts, one outside doesn't");
  assert.equal(nearestLine(nearestAndClosures("bank", area, [])), "No bank in the circle or within 2 km.");

  const e = evidenceSize("laundry", area, set, { businessIds: ["places:A", "places:C"], reviewCount: 3 });
  assert.deepEqual([e.tracts, e.inCircle, e.competitors, e.reviews], [3, 2, 4, 3], "review:A:0 counts once");
  assert.equal(
    evidenceLine(e),
    "Based on 3 census tracts, 4 competitors within 2 km and 3 reviews. The success profile compares 2 businesses, using 3 reviews.",
  );
  assert.equal(evidenceLine(evidenceSize("laundry", area, null)), "Based on 3 census tracts, 2 laundromats in the circle and 2 reviews.");

  const restaurants = [
    business("places:R1", "restaurant", 200, { priceLevel: 1, priceRange: { min: 10, max: 20 } }),
    business("places:R2", "restaurant", 400, { priceLevel: 2, priceRange: { min: 20, max: 30 } }),
    business("places:R3", "restaurant", 600, { priceLevel: 2, priceRange: { min: 20, max: 30 } }),
    business("places:R4", "restaurant", 800, { priceLevel: 3, priceRange: { min: 50, max: null } }),
    business("places:R5", "restaurant", 900),
  ];
  const p = priceMix("restaurant", area.demographics, restaurants);
  assert.ok(p);
  assert.deepEqual(p.byLevel, [0, 1, 2, 1, 0]);
  assert.deepEqual(p.typicalRange, { min: 20, max: 30, of: 4 });
  assert.equal(
    priceLine(p),
    "4 of 5 restaurants within 2 km list a price level: 1 at $, 2 at $$ and 1 at $$$. Typically $20–30 a person. " +
      "Median household income here is about $160,000, 2.0 times the US figure of $80,000.",
  );
  assert.equal(priceMix("restaurant", area.demographics, restaurants.slice(1)), null, "3 priced is too few");

  console.log("Sample checks passed.");
}

async function printDemo(demo: (typeof DEMO_AREAS)[number], all: boolean) {
  const { lat, lng } = demo.center;
  const area = await collectArea(lat, lng);
  const gaps = scoreGaps(area, benchmarkFor(demo.center));
  const picked = all ? gaps : gaps.slice(0, 3);
  const income = area.demographics?.medianIncome;
  console.log(
    `\n${demo.name} (${area.from} data, population ${area.demographics?.population ?? "unknown"}, ` +
      `median income ${income ? `$${income.toLocaleString("en-US")}` : "unknown"})`,
  );

  const results = await Promise.all(picked.map((g) => collectCompetitors(g.category, lat, lng)));
  picked.forEach((g, i) => {
    const r = results[i];
    const competitors: CompetitorSet | null = r.ok ? { businesses: r.data.businesses, docs: r.docs } : null;
    const nearest = nearestAndClosures(g.category, area, competitors?.businesses ?? null);
    const price = competitors && priceMix(g.category, area.demographics, competitors.businesses);
    const priced = competitors?.businesses.filter((b) => b.priceLevel !== undefined).length ?? 0;

    console.log(`\n  ${g.category}, score ${g.score}${r.ok ? "" : ` (competitor search failed: ${r.error})`}`);
    console.log(`    ${evidenceLine(evidenceSize(g.category, area, competitors))}`);
    const notes = [
      nearest.nearest && `nearest: ${nearest.nearest.name}`,
      nearest.openOnMap !== nearest.openInCircle && `${nearest.openOnMap} of ${nearest.openInCircle} in the circle are on the map`,
    ].filter(Boolean);
    console.log(`    ${nearestLine(nearest)}${notes.length ? `  [${notes.join("; ")}]` : ""}`);
    console.log(`    ${price ? priceLine(price) : `(no price mix: ${priced} competitors have a price level)`}`);
  });
}

async function main() {
  checkSample();
  const all = process.argv.includes("--all");
  for (const demo of DEMO_AREAS) await printDemo(demo, all);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
