import { test } from "node:test";
import assert from "node:assert/strict";
import { pickConceptCategories } from "../src/lib/analysis/candidates";
import { emptyCounts } from "../src/lib/ingest/categories";
import type { AreaData, Gap } from "../src/lib/types";

const area = (counts: Partial<AreaData["categoryCounts"]>): AreaData => ({
  center: { lat: 30.2672, lng: -97.7431 },
  radiusM: 800,
  businesses: [],
  demographics: {
    tractFips: ["48453001100"],
    population: 5000,
    medianIncome: 90000,
    medianAge: 33,
    medianRent: 1800,
    pctRenters: 70,
    pctWithKids: 15,
    pctNoVehicle: 9,
  },
  categoryCounts: { ...emptyCounts(), ...counts },
  docs: [],
  errors: [],
});

test("an area where every category meets its benchmark still gets three best-fit concepts", () => {
  // A downtown with more of everything than its residents need, and no competitor data.
  const gaps: Gap[] = [
    { category: "pharmacy", localPer1k: 0.4, benchmarkPer1k: 0.2, score: 0 },
    { category: "cafe", localPer1k: 2, benchmarkPer1k: 0.9, score: 0 },
    { category: "bar", localPer1k: 1.5, benchmarkPer1k: 0.3, score: 0 },
    { category: "restaurant", localPer1k: 8, benchmarkPer1k: 2, score: 0 },
  ];
  const picked = pickConceptCategories(
    area({ pharmacy: 2, cafe: 10, bar: 8, restaurant: 40 }),
    gaps,
    {},
  );
  assert.deepEqual(
    picked.map((c) => [c.category, c.gapType]),
    [
      ["pharmacy", "best_fit"],
      ["cafe", "best_fit"],
      ["bar", "best_fit"],
    ],
  );
  assert(picked.every((c) => c.facts.length > 0));
});

test("measured gaps come first, and best-fit only fills the remaining slots", () => {
  const gaps: Gap[] = [
    { category: "laundry", localPer1k: 0, benchmarkPer1k: 0.4, score: 1.1 },
    { category: "pharmacy", localPer1k: 0.4, benchmarkPer1k: 0.2, score: 0 },
    { category: "cafe", localPer1k: 2, benchmarkPer1k: 0.9, score: 0 },
  ];
  const picked = pickConceptCategories(
    area({ laundry: 0, pharmacy: 2, cafe: 10 }),
    gaps,
    {},
  );
  assert.deepEqual(
    picked.map((c) => [c.category, c.gapType]),
    [
      ["laundry", "unserved"],
      ["pharmacy", "best_fit"],
      ["cafe", "best_fit"],
    ],
  );
});

test("an area outside the US gets no concept categories", () => {
  assert.deepEqual(
    pickConceptCategories({ ...area({}), demographics: null }, [], {}),
    [],
  );
});
