// Runs scoreGaps on a hand-written area and checks the basic rules. With --demo, it also scores
// both demo areas from live data.
//
//   npx tsx scripts/check-gaps.ts
//   npx tsx scripts/check-gaps.ts --demo
//
// collectArea() isn't on main yet, so --demo builds a stand-in AreaData: OSM counts from one
// Overpass query for the 800 m circle, and the 2020 Census population of the tracts whose center
// point is in the circle, from TIGERweb (no key needed). The demographic percentages need ACS,
// so they are null and every demand weight is 1. Replace this with collectArea once it lands.

import assert from "node:assert/strict";
import type { AreaData, CategoryId, Demographics, Gap } from "../src/lib/types";
import { CATEGORY_IDS, emptyCounts } from "../src/lib/ingest/categories";
import { DEMO_AREAS, AREA_RADIUS_M } from "../src/lib/ingest/demo-areas";
import { isInCircle } from "../src/lib/ingest/geo";
import { fetchJson } from "../src/lib/ingest/http";
import { BENCHMARKS, benchmarkFor, type Benchmark } from "../src/lib/analysis/benchmarks";
import { MIN_EXPECTED_COUNT, demandFit, scoreGaps } from "../src/lib/analysis/gap-score";
import { USER_AGENT, businessQuery, countByCategory, runOverpass } from "./lib/osm";

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

type TractQuery = { features?: { attributes: { GEOID: string; POP100: number; CENTLAT: string; CENTLON: string } }[] };

const TIGER_TRACTS =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/6/query";

// 2020 population of the tracts whose center point is in the circle, or of the tract
// containing the center if none is.
async function circlePopulation(lat: number, lng: number, radiusM: number) {
  const query = (distance: number) =>
    `${TIGER_TRACTS}?` +
    new URLSearchParams({
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(distance),
      units: "esriSRUnit_Meter",
      outFields: "GEOID,POP100,CENTLAT,CENTLON",
      returnGeometry: "false",
      f: "json",
    });
  const opts = { headers: { "User-Agent": USER_AGENT }, timeoutMs: 60_000 };
  const near = await fetchJson<TractQuery>(query(radiusM), opts);
  let tracts = (near.features ?? [])
    .map((f) => f.attributes)
    .filter((t) => isInCircle({ lat, lng }, { lat: parseFloat(t.CENTLAT), lng: parseFloat(t.CENTLON) }, radiusM));
  if (tracts.length === 0) tracts = ((await fetchJson<TractQuery>(query(0), opts)).features ?? []).map((f) => f.attributes);
  return { tractFips: tracts.map((t) => t.GEOID), population: tracts.reduce((sum, t) => sum + t.POP100, 0) };
}

async function demoArea(slug: string): Promise<AreaData> {
  const demo = DEMO_AREAS.find((a) => a.slug === slug)!;
  const { lat, lng } = demo.center;
  const elements = await runOverpass(businessQuery("", `(around:${AREA_RADIUS_M},${lat},${lng})`, 60), 90_000);
  const { tractFips, population } = await circlePopulation(lat, lng, AREA_RADIUS_M);
  return {
    center: demo.center,
    radiusM: AREA_RADIUS_M,
    businesses: [],
    demographics: {
      tractFips,
      population,
      medianIncome: null,
      medianAge: null,
      medianRent: null,
      pctRenters: null,
      pctWithKids: null,
      pctNoVehicle: null,
    },
    categoryCounts: countByCategory(elements),
    docs: [],
    errors: [],
  };
}

async function main() {
  checkSample();
  if (!process.argv.includes("--demo")) return;
  for (const demo of DEMO_AREAS) {
    const area = await demoArea(demo.slug);
    const benchmark = benchmarkFor(demo.center);
    const gaps = scoreGaps(area, benchmark);
    printTable(`${demo.name} (stand-in data, ${area.demographics!.tractFips.length} tracts)`, area, benchmark, gaps);
    const positive = gaps.filter((g) => g.score > 0);
    console.log(`${positive.length} of ${gaps.length} scored categories have a gap.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
