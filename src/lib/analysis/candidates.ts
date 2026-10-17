// Picks the concept categories and their gap types: steps 3 and 5 of "How /api/analyze runs" in
// docs/ANALYSIS_PLAN.md, with the rules from "Gap type rules" and "The mismatched checks".
// Every number here comes from the area's counts and the 2 km competitor data, never from Claude.
// GapType and the types below are local until the team adds them to src/lib/types.ts.

import type { AreaData, Business, CategoryId, Gap } from "../types";
import { MIN_EXPECTED_COUNT } from "./gap-score";

export const CONCEPT_COUNT = 3;

export type GapType = "unserved" | "poorly_served" | "mismatched";

// A category that matches more than one type takes the first in this order.
export const GAP_TYPES: GapType[] = ["unserved", "poorly_served", "mismatched"];

// unserved: the circle has at most half its benchmark.
const UNSERVED_MIN_SHORTFALL = 0.5;
// poorly_served: at least 4 rated competitors within 2 km, averaging below 4.0.
const MIN_RATED = 4;
const POOR_AVG_RATING = 4.0;
// mismatched: a check needs at least 4 competitors that have its field.
const MIN_WITH_FIELD = 4;
const LATE_HOUR = 21; // open after 9 pm means closesAt > 21

const FOOD_AND_DRINK: CategoryId[] = ["restaurant", "fast_food", "cafe", "bar", "bakery", "specialty_food"];
const LATE_HOURS_CATEGORIES: CategoryId[] = [...FOOD_AND_DRINK, "grocery", "pharmacy", "laundry", "fitness"];
// Only restaurants and bars, where level 1 carries information (see the plan).
const BUDGET_CATEGORIES: CategoryId[] = ["restaurant", "bar"];
const DELIVERY_CATEGORIES: CategoryId[] = [...FOOD_AND_DRINK, "grocery"];

export type MismatchCheck = "late_hours" | "budget_price" | "delivery";

// A mismatched check that fired: none of the `of` competitors with the field offer the option.
export type Mismatch = {
  check: MismatchCheck;
  of: number;
  cheapest?: NonNullable<Business["priceRange"]>; // budget_price only, when any competitor has a price range
};

// The numbers behind a category's gap type.
export type GapNumbers = {
  count: number; // OpenStreetMap businesses in the circle, as in the gap table
  expected: number; // what the circle would have at the benchmark: benchmark per 1,000 × residents / 1,000
  shortfall: number; // 1 - count / expected; negative when the circle has more than expected
  competitors: number; // Places businesses within 2 km; 0 when the search failed
  rated: number; // competitors with a rating
  avgRating: number | null;
  mismatches: Mismatch[]; // the mismatched checks that fired, in the plan's order
};

// A concept category: its gap, its type, and the numbers behind the type, also as sentences for the
// prompt and the card ("4 grocery stores within 2 km average 3.4 stars"). The type's own facts come first.
export type ConceptCategory = Gap & {
  gapType: GapType;
  numbers: GapNumbers;
  facts: string[];
};

// Competitors within 2 km by category. A category whose search failed is missing.
export type CompetitorsByCategory = Partial<Record<CategoryId, Business[]>>;

// Candidates are the top gaps by score plus the categories the 2 km data shows as poorly rated. Each
// gets the first type it matches; a candidate that matches none is left out, so an area can get fewer
// than `count`. Keeps one of each type where possible, then fills by score, and returns them strongest
// first. Ties on score go to the gap table's order, which puts the least served first.
export function pickConceptCategories(
  area: AreaData,
  gaps: Gap[],
  competitors: CompetitorsByCategory,
  count = CONCEPT_COUNT,
): ConceptCategory[] {
  const population = area.demographics?.population ?? 0;
  if (population <= 0) return [];

  const topGaps = gaps.filter((g) => g.score > 0).slice(0, count);
  const poorlyRated = gaps.filter((g) => isPoorlyRated(ratings(competitors[g.category] ?? [])));
  const candidates = [...new Set([...topGaps, ...poorlyRated])];

  const typed = candidates.flatMap((gap) => {
    const numbers = gapNumbers(gap, area.categoryCounts[gap.category] ?? 0, population, competitors[gap.category]);
    const gapType = typeOf(numbers);
    return gapType ? [{ ...gap, gapType, numbers, facts: describeNumbers(gap.category, gapType, numbers, population) }] : [];
  });
  const order = new Map(gaps.map((g, i) => [g.category, i]));
  const rank = (a: ConceptCategory, b: ConceptCategory) =>
    b.score - a.score || order.get(a.category)! - order.get(b.category)!;
  typed.sort(rank);

  const picked = GAP_TYPES.flatMap((t) => typed.find((c) => c.gapType === t) ?? []).slice(0, count);
  for (const c of typed) {
    if (picked.length >= count) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.sort(rank);
}

export function typeOf(n: GapNumbers): GapType | null {
  if (n.shortfall >= UNSERVED_MIN_SHORTFALL && n.expected >= MIN_EXPECTED_COUNT) return "unserved";
  if (isPoorlyRated({ rated: n.rated, avgRating: n.avgRating })) return "poorly_served";
  if (n.mismatches.length > 0) return "mismatched";
  return null;
}

function isPoorlyRated(r: { rated: number; avgRating: number | null }): boolean {
  return r.rated >= MIN_RATED && r.avgRating !== null && r.avgRating < POOR_AVG_RATING;
}

function ratings(businesses: Business[]): { rated: number; avgRating: number | null } {
  const values = businesses.flatMap((b) => (b.rating !== undefined ? [b.rating] : []));
  if (values.length === 0) return { rated: 0, avgRating: null };
  return { rated: values.length, avgRating: round(values.reduce((a, b) => a + b, 0) / values.length, 2) };
}

function gapNumbers(gap: Gap, count: number, population: number, competitors: Business[] = []): GapNumbers {
  const expected = (gap.benchmarkPer1k * population) / 1000;
  return {
    count,
    expected: round(expected, 1),
    shortfall: round(1 - count / expected, 2),
    competitors: competitors.length,
    ...ratings(competitors),
    mismatches: mismatches(gap.category, competitors),
  };
}

// The plan's three checks. A missing field means unknown, not "no", so each counts only the
// competitors that have its field.
function mismatches(category: CategoryId, competitors: Business[]): Mismatch[] {
  const found: Mismatch[] = [];

  const closes = withField(competitors, (b) => b.closesAt);
  if (LATE_HOURS_CATEGORIES.includes(category) && closes.length >= MIN_WITH_FIELD && closes.every((h) => h <= LATE_HOUR)) {
    found.push({ check: "late_hours", of: closes.length });
  }

  const levels = withField(competitors, (b) => b.priceLevel);
  if (BUDGET_CATEGORIES.includes(category) && levels.length >= MIN_WITH_FIELD && !levels.includes(1)) {
    const cheapest = withField(competitors, (b) => b.priceRange).sort((a, b) => a.min - b.min)[0];
    found.push({ check: "budget_price", of: levels.length, ...(cheapest ? { cheapest } : {}) });
  }

  const delivery = withField(competitors, (b) => b.services?.delivery);
  if (DELIVERY_CATEGORIES.includes(category) && delivery.length >= MIN_WITH_FIELD && delivery.every((d) => !d)) {
    found.push({ check: "delivery", of: delivery.length });
  }
  return found;
}

const withField = <T>(bs: Business[], get: (b: Business) => T | undefined) =>
  bs.map(get).filter((v): v is T => v !== undefined);

// Singular and plural, for the card text.
const NOUNS: Record<CategoryId, [string, string]> = {
  grocery: ["grocery store", "grocery stores"],
  specialty_food: ["specialty food shop", "specialty food shops"],
  convenience: ["convenience store", "convenience stores"],
  bakery: ["bakery", "bakeries"],
  restaurant: ["restaurant", "restaurants"],
  fast_food: ["fast food place", "fast food places"],
  cafe: ["café", "cafés"],
  bar: ["bar", "bars"],
  liquor: ["liquor store", "liquor stores"],
  pharmacy: ["pharmacy", "pharmacies"],
  medical: ["medical office", "medical offices"],
  laundry: ["laundromat or dry cleaner", "laundromats and dry cleaners"],
  hair_beauty: ["hair or beauty salon", "hair and beauty salons"],
  fitness: ["gym or studio", "gyms and studios"],
  childcare: ["childcare center", "childcare centers"],
  pet: ["pet business", "pet businesses"],
  clothing: ["clothing store", "clothing stores"],
  hardware: ["hardware store", "hardware stores"],
  bank: ["bank", "banks"],
  books: ["bookstore", "bookstores"],
};

const noun = (category: CategoryId, n: number) => NOUNS[category][n === 1 ? 0 : 1];

// The numbers as sentences, the gap type's own first.
export function describeNumbers(category: CategoryId, gapType: GapType, n: GapNumbers, population: number): string[] {
  const plural = noun(category, 2);
  const lines: Record<GapType, string[]> = {
    unserved: [
      `${n.count} ${noun(category, n.count)} in the circle, against about ${n.expected} expected at the benchmark rate for its ${population.toLocaleString("en-US")} residents`,
    ],
    poorly_served:
      n.avgRating === null
        ? []
        : [`${n.rated} rated ${noun(category, n.rated)} within 2 km average ${n.avgRating.toFixed(1)} stars`],
    mismatched: n.mismatches.map((m) => {
      if (m.check === "late_hours") return `None of the ${m.of} ${plural} within 2 km that list hours is open after 9 pm`;
      if (m.check === "delivery") return `None of the ${m.of} ${plural} within 2 km that list delivery offers it`;
      const cheapest = m.cheapest ? `; the cheapest costs ${priceRange(m.cheapest)} a person` : "";
      return `None of the ${m.of} ${plural} within 2 km that list a price level is at the lowest level ($)${cheapest}`;
    }),
  };
  return [gapType, ...GAP_TYPES.filter((t) => t !== gapType)].flatMap((t) => lines[t]);
}

const priceRange = (r: NonNullable<Business["priceRange"]>) => (r.max === null ? `$${r.min}+` : `$${r.min}–${r.max}`);
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
