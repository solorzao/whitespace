// The gap score: how far each category in the circle falls short of its benchmark, per resident,
// nudged by how well the category fits the circle's demographics.

import type { AreaData, CategoryId, Demographics, Gap } from "../types";
import { CATEGORY_IDS } from "../ingest/categories";
import type { Benchmark } from "./benchmarks";

// Below one expected business, a missing category is noise rather than a gap.
export const MIN_EXPECTED_COUNT = 1;

// Each demand signal moves a category's score by at most this fraction, up or down.
const MAX_NUDGE = 0.25;

type NumericField = "medianIncome" | "medianAge" | "pctRenters" | "pctWithKids" | "pctNoVehicle";

// `us` is the rough US figure (ACS 5-year), where the weight is 1. At `us ± spread` or beyond,
// the weight is 1 ± MAX_NUDGE. Percentages are 0–100.
const DEMAND_SIGNALS: Partial<Record<CategoryId, { field: NumericField; us: number; spread: number }>> = {
  laundry: { field: "pctRenters", us: 35, spread: 35 }, // renters are less likely to have a washer at home
  childcare: { field: "pctWithKids", us: 30, spread: 20 }, // households with children need daycare and preschool
  specialty_food: { field: "medianIncome", us: 80_000, spread: 60_000 }, // higher incomes spend more on delis, butchers and health food
  grocery: { field: "pctNoVehicle", us: 8, spread: 30 }, // households without a car buy food within walking distance
  pharmacy: { field: "pctNoVehicle", us: 8, spread: 30 }, // the same for prescriptions
  convenience: { field: "pctNoVehicle", us: 8, spread: 30 }, // and for everyday items
  medical: { field: "medianAge", us: 39, spread: 15 }, // older residents see doctors and dentists more often
};

export function demandFit(category: CategoryId, demographics: Demographics): number {
  const signal = DEMAND_SIGNALS[category];
  if (!signal) return 1;
  const value = demographics[signal.field];
  if (value == null) return 1;
  const z = Math.max(-1, Math.min(1, (value - signal.us) / signal.spread));
  return 1 + MAX_NUDGE * z;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// Highest score first. Categories at or above their benchmark stay in the list with a score of 0,
// so the analysis can also see what the area already has plenty of.
export function scoreGaps(area: AreaData, benchmark: Benchmark): Gap[] {
  const demographics = area.demographics;
  if (!demographics || demographics.population <= 0) return [];
  const thousands = demographics.population / 1000;

  const gaps: Gap[] = [];
  for (const category of CATEGORY_IDS) {
    const benchmarkPer1k = benchmark.per1k[category];
    if (benchmarkPer1k * thousands < MIN_EXPECTED_COUNT) continue;
    const localPer1k = (area.categoryCounts[category] ?? 0) / thousands;
    // Relative, so a common category like restaurants doesn't win just by having big numbers.
    const shortfall = Math.max(0, 1 - localPer1k / benchmarkPer1k);
    gaps.push({
      category,
      localPer1k: round3(localPer1k),
      benchmarkPer1k: round3(benchmarkPer1k),
      score: round3(shortfall * demandFit(category, demographics)),
    });
  }

  // Ties, mostly the categories scoring 0, go to the least served first.
  const served = (g: Gap) => g.localPer1k / g.benchmarkPer1k;
  return gaps.sort((a, b) => b.score - a.score || served(a) - served(b));
}
