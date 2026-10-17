// Runs scoreGaps on a hand-written area and checks the basic rules. With --demo, it also runs
// collectArea on both demo areas and scores them.
//
//   npx tsx scripts/check-gaps.ts
//   npx tsx --env-file=.env.local scripts/check-gaps.ts --demo
//
// Without CENSUS_API_KEY, collectArea has no demographics, so --demo falls back to the 2020 Census
// population (POP100, from TIGERweb, no key needed) of the same tracts collectArea would pick.
// The demographic percentages need ACS, so in that case every demand weight is 1.

import assert from "node:assert/strict";
import type { AreaData, CategoryId, Demographics, Gap } from "../src/lib/types";
import { CATEGORY_IDS, emptyCounts } from "../src/lib/ingest/categories";
import { AREA_RADIUS_M, DEMO_AREAS, collectArea } from "../src/lib/ingest/index";
import { isInCircle } from "../src/lib/ingest/geo";
import { errorMessage, fetchJson } from "../src/lib/ingest/http";
import { USER_AGENT } from "../src/lib/ingest/result";
import { BENCHMARKS, benchmarkFor, type Benchmark } from "../src/lib/analysis/benchmarks";
import { MIN_EXPECTED_COUNT, demandFit, scoreGaps } from "../src/lib/analysis/gap-score";

function printTable(title: string, area: AreaData, benchmark: Benchmark, gaps: Gap[]) {
  const d = area.demographics;
  console.log(`\n${title}, against ${benchmark.name}, population ${d?.population ?? "none"}`);
  const scored = new Set(gaps.map((g) => g.category));
  const rows = gaps.map((g) => ({
    category: g.category,
    count: area.categoryCounts[g.category],
    expected: +((g.benchmarkPer1k * (d?.population ?? 0)) / 1000).toFixed(1),
    localPer1k: g.localPer1k,
    benchmarkPer1k: g.benchmarkPer1k,
    weight: d ? demandFit(g.category, d) : 1,
    score: g.score,
  }));
  console.table(rows);
  const skipped = CATEGORY_IDS.filter((c) => !scored.has(c));
  if (skipped.length) console.log(`Skipped, fewer than ${MIN_EXPECTED_COUNT} expected: ${skipped.join(", ")}`);
}

// A residential part of Santa Monica with 15,000 people. Every category is at its Santa Monica
// rate except laundry (none), grocery (one, against about 2.7 expected) and books (one, but only
// 0.8 expected, so it's skipped).
function sampleArea(): AreaData {
  const population = 15_000;
  const benchmark = BENCHMARKS["santa-monica"];
  const counts = emptyCounts();
  for (const id of CATEGORY_IDS) counts[id] = Math.round((benchmark.per1k[id] * population) / 1000);
  counts.laundry = 0;
  counts.grocery = 1;
  counts.books = 1;
  const demographics: Demographics = {
    tractFips: ["06037701801", "06037701802", "06037701902", "06037702000"],
    population,
    medianIncome: 105_000,
    medianAge: 41,
    medianRent: 2_300,
    pctRenters: 70,
    pctWithKids: 18,
    pctNoVehicle: 12,
  };
  return {
    center: DEMO_AREAS[0].center,
    radiusM: AREA_RADIUS_M,
    businesses: [],
    demographics,
    categoryCounts: counts,
    docs: [],
    errors: [],
  };
}

function checkSample() {
  const area = sampleArea();
  const benchmark = BENCHMARKS["santa-monica"];
  const gaps = scoreGaps(area, benchmark);
  printTable("Hand-written sample", area, benchmark, gaps);

  const byCategory = new Map(gaps.map((g) => [g.category, g]));
  const rank = (c: CategoryId) => gaps.findIndex((g) => g.category === c);

  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i - 1].score >= gaps[i].score, "sorted by score");
  assert.ok(byCategory.get("restaurant")!.score < 0.05, "a category at its benchmark scores about 0");
  assert.equal(rank("laundry"), 0, "a missing category with expected >= 1 ranks first");
  assert.ok(byCategory.get("laundry")!.score > 1, "renters push laundry above a plain shortfall of 1");
  assert.ok(rank("grocery") > 0 && rank("grocery") < 3, "an under-served category ranks near the top");
  assert.ok(!byCategory.has("books"), "a category with expected < 1 is skipped");

  assert.deepEqual(scoreGaps({ ...area, demographics: null }, benchmark), [], "no demographics → no gaps");
  const empty = { ...area, demographics: { ...area.demographics!, population: 0 } };
  assert.deepEqual(scoreGaps(empty, benchmark), [], "no residents → no gaps");

  assert.equal(benchmarkFor({ lat: 34.0195, lng: -118.4912 }).slug, "santa-monica");
  assert.equal(benchmarkFor({ lat: 40.7075, lng: -74.0113 }).slug, "lower-manhattan");
  assert.equal(benchmarkFor({ lat: 41.8781, lng: -87.6298 }).slug, "default");

  console.log("Sample checks passed.");
}

type TractQuery = { features?: { attributes: { GEOID: string; POP100: number; INTPTLAT: string; INTPTLON: string } }[] };

const TIGER_2020_TRACTS =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/6/query";

// The 2020 population of the tracts whose internal point is in the circle, or of the tract that
// contains the center if none is: the same rule as src/lib/ingest/census.ts.
async function census2020Demographics(lat: number, lng: number, radiusM: number): Promise<Demographics> {
  const query = (distance: number) =>
    `${TIGER_2020_TRACTS}?` +
    new URLSearchParams({
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(distance),
      units: "esriSRUnit_Meter",
      outFields: "GEOID,POP100,INTPTLAT,INTPTLON",
      returnGeometry: "false",
      f: "json",
    });
  const opts = { headers: { "User-Agent": USER_AGENT }, timeoutMs: 60_000 };
  const tractsOf = (res: TractQuery) => (res.features ?? []).map((f) => f.attributes);
  let tracts = tractsOf(await fetchJson<TractQuery>(query(radiusM), opts)).filter((t) =>
    isInCircle({ lat, lng }, { lat: Number(t.INTPTLAT), lng: Number(t.INTPTLON) }, radiusM),
  );
  if (tracts.length === 0) tracts = tractsOf(await fetchJson<TractQuery>(query(0), opts));
  return {
    tractFips: tracts.map((t) => t.GEOID),
    population: tracts.reduce((sum, t) => sum + t.POP100, 0),
    medianIncome: null,
    medianAge: null,
    medianRent: null,
    pctRenters: null,
    pctWithKids: null,
    pctNoVehicle: null,
  };
}

async function checkDemo(demo: (typeof DEMO_AREAS)[number]) {
  const { lat, lng } = demo.center;
  const area: AreaData = await collectArea(lat, lng);
  for (const e of area.errors) console.log(`\n${demo.name}: ${e.source} failed: ${e.message}`);
  let source = "ACS 2020–2024";
  if (!area.demographics) {
    area.demographics = await census2020Demographics(lat, lng, area.radiusM);
    source = "2020 Census counts, no demand weights";
  }
  const benchmark = benchmarkFor(demo.center);
  const gaps = scoreGaps(area, benchmark);
  printTable(`${demo.name} (${area.demographics.tractFips.length} tracts, ${source})`, area, benchmark, gaps);
  console.log(`${gaps.filter((g) => g.score > 0).length} of ${gaps.length} scored categories have a gap.`);
}

async function main() {
  checkSample();
  if (!process.argv.includes("--demo")) return;
  for (const demo of DEMO_AREAS) {
    // Overpass is often busy, so give each area a second try.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await checkDemo(demo);
        break;
      } catch (err) {
        console.log(`\n${demo.name}, attempt ${attempt}: ${errorMessage(err)}`);
        if (attempt === 1) await new Promise((r) => setTimeout(r, 30_000));
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
