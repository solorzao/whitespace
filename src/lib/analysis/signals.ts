// Small signals for the concept cards, each a count from the area and its 2 km competitors, with the
// card line that states it. No Claude calls. The types are local until the team agrees on new Gap or
// Concept fields (ANALYSIS_PLAN.md, "Contract changes").

import type { AreaData, Business, CategoryId, Demographics, SourceDoc } from "../types";
import { COMPETITOR_RADIUS_M, competitorsNotOnMap } from "../ingest/competitors";
import { distanceM } from "../ingest/geo";

// The 2 km competitor search for one category: CompetitorsData.businesses plus the result's docs.
export type CompetitorSet = { businesses: Business[]; docs: SourceDoc[] };

// The parts of a success profile these signals read, so this file doesn't depend on profile.ts.
export type ProfileSize = { businessIds: string[]; reviewCount: number };

// Singular and plural, for card lines.
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
  laundry: ["laundromat", "laundromats"],
  hair_beauty: ["salon", "salons"],
  fitness: ["gym", "gyms"],
  childcare: ["daycare", "daycares"],
  pet: ["pet business", "pet businesses"],
  clothing: ["clothing store", "clothing stores"],
  hardware: ["hardware store", "hardware stores"],
  bank: ["bank", "banks"],
  books: ["bookstore", "bookstores"],
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const countOf = (n: number, category: CategoryId) => count(n, ...NOUNS[category]);

const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${+(m / 1000).toFixed(1)} km`);

// "a", "a and b", "a, b and c"
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const inCategory = (bs: Business[], category: CategoryId) => bs.filter((b) => b.category === category);

// OSM has no status, so a business without one counts as open.
const isOpen = (b: Business) => b.status === undefined || b.status === "open";

// --- 1. Evidence size ---

export type EvidenceSize = {
  category: CategoryId;
  tracts: number; // census tracts in the circle
  inCircle: number; // the category's businesses in the 800 m circle
  competitors: number | null; // the category's businesses within 2 km; null when the search failed
  reviews: number; // the category's review docs, circle and 2 km, each id once
  profile: { businesses: number; reviews: number } | null;
};

export function evidenceSize(
  category: CategoryId,
  area: Pick<AreaData, "demographics" | "businesses" | "docs">,
  competitors: CompetitorSet | null,
  profile: ProfileSize | null = null,
): EvidenceSize {
  const reviewIds = new Set<string>();
  for (const d of [...area.docs, ...(competitors?.docs ?? [])]) {
    if (d.source === "review" && d.category === category) reviewIds.add(d.id);
  }
  return {
    category,
    tracts: area.demographics?.tractFips.length ?? 0,
    inCircle: inCategory(area.businesses, category).length,
    competitors: competitors ? inCategory(competitors.businesses, category).length : null,
    reviews: reviewIds.size,
    profile: profile ? { businesses: profile.businessIds.length, reviews: profile.reviewCount } : null,
  };
}

// "Based on 3 census tracts, 9 competitors within 2 km and 36 reviews."
export function evidenceLine(e: EvidenceSize): string {
  const parts: string[] = [];
  if (e.tracts > 0) parts.push(count(e.tracts, "census tract"));
  if (e.competitors !== null) parts.push(`${count(e.competitors, "competitor")} within ${formatDistance(COMPETITOR_RADIUS_M)}`);
  else parts.push(`${countOf(e.inCircle, e.category)} in the circle`);
  parts.push(count(e.reviews, "review"));
  let line = `Based on ${joinList(parts)}.`;
  if (e.profile) {
    line += ` The success profile compares ${count(e.profile.businesses, "business", "businesses")}, using ${count(e.profile.reviews, "review")}.`;
  }
  return line;
}

// --- 2. Nearest competitor and closures ---

export type NearestAndClosures = {
  category: CategoryId;
  openOnMap: number; // open in the circle's businesses, which OSM can miss
  openInCircle: number; // open within the circle's radius, adding 2 km competitors that aren't on the map
  closedForGood: number; // permanently closed, circle and 2 km, each business once
  closedTemporarily: number; // the same for temporary closures, which don't count as closures
  nearest: { id: string; name: string; distanceM: number } | null; // nearest open one, circle or 2 km
  competitorRadiusM: number | null; // 2000, or null when the 2 km search failed and only the circle was seen
};

export function nearestAndClosures(
  category: CategoryId,
  area: Pick<AreaData, "center" | "radiusM" | "businesses">,
  competitors: Business[] | null,
): NearestAndClosures {
  const onMap = inCategory(area.businesses, category);
  const all = [...onMap, ...competitorsNotOnMap(onMap, inCategory(competitors ?? [], category))];
  const open = all.filter(isOpen).map((b) => ({ b, d: distanceM(area.center, b) }));
  let nearest: NearestAndClosures["nearest"] = null;
  for (const { b, d } of open) {
    if (!nearest || d < nearest.distanceM) nearest = { id: b.id, name: b.name, distanceM: Math.round(d) };
  }
  return {
    category,
    openOnMap: onMap.filter(isOpen).length,
    openInCircle: open.filter(({ d }) => d <= area.radiusM).length,
    closedForGood: all.filter((b) => b.status === "closed_permanently").length,
    closedTemporarily: all.filter((b) => b.status === "closed_temporarily").length,
    nearest,
    competitorRadiusM: competitors ? COMPETITOR_RADIUS_M : null,
  };
}

// "No laundromat in the circle. The nearest is 1.4 km away, and 2 nearby have closed for good."
export function nearestLine(n: NearestAndClosures): string {
  const [one] = NOUNS[n.category];
  const beyond = n.competitorRadiusM ? ` or within ${formatDistance(n.competitorRadiusM)}` : "";
  const closed = n.closedForGood > 0 ? `${n.closedForGood} nearby ${n.closedForGood === 1 ? "has" : "have"} closed for good` : null;
  if (n.nearest) {
    const first = n.openInCircle > 0 ? `${countOf(n.openInCircle, n.category)} in the circle.` : `No ${one} in the circle.`;
    return `${first} The nearest is ${formatDistance(n.nearest.distanceM)} away${closed ? `, and ${closed}` : ""}.`;
  }
  const first = `No ${one} in the circle${beyond}.`;
  return closed ? `${first} ${closed[0].toUpperCase()}${closed.slice(1)}.` : first;
}

// --- 3. Price mix against income ---

// Below this many competitors with a price level, the mix says too little to show.
export const MIN_PRICED = 4;

// The rough US median household income that gap-score.ts compares income with.
export const US_MEDIAN_INCOME = 80_000;

export type PriceMix = {
  category: CategoryId;
  competitors: number; // the category's businesses within 2 km
  priced: number; // those with a price level
  byLevel: [number, number, number, number, number]; // how many at each level, 0 (free) to 4
  // Lower medians of the priceRange mins and maxes, so both are values a competitor has. max null = open-ended.
  typicalRange: { min: number; max: number | null; of: number } | null;
  medianIncome: number | null;
  usMedianIncome: number;
};

// The middle value, or the lower of the two middle values, so it is always one of the inputs.
function lowerMedian(sorted: number[]): number {
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

// null when fewer than MIN_PRICED competitors have a price level.
export function priceMix(category: CategoryId, demographics: Demographics | null, competitors: Business[]): PriceMix | null {
  const ofCategory = inCategory(competitors, category);
  const byLevel: PriceMix["byLevel"] = [0, 0, 0, 0, 0];
  let priced = 0;
  for (const b of ofCategory) {
    if (b.priceLevel === undefined) continue;
    byLevel[b.priceLevel] += 1;
    priced += 1;
  }
  if (priced < MIN_PRICED) return null;

  const ranges = ofCategory.flatMap((b) => (b.priceRange ? [b.priceRange] : []));
  let typicalRange: PriceMix["typicalRange"] = null;
  if (ranges.length > 0) {
    const max = lowerMedian(ranges.map((r) => r.max ?? Infinity).sort((a, b) => a - b));
    typicalRange = {
      min: lowerMedian(ranges.map((r) => r.min).sort((a, b) => a - b)),
      max: Number.isFinite(max) ? max : null,
      of: ranges.length,
    };
  }
  return {
    category,
    competitors: ofCategory.length,
    priced,
    byLevel,
    typicalRange,
    medianIncome: demographics?.medianIncome ?? null,
    usMedianIncome: US_MEDIAN_INCOME,
  };
}

const LEVEL_TEXT = ["free", "$", "$$", "$$$", "$$$$"];

const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;

function incomeComparison(income: number, us: number): string {
  const ratio = income / us;
  if (ratio >= 1.95) return `${ratio.toFixed(1)} times`;
  const pct = Math.round((ratio - 1) * 100);
  if (pct === 0) return "about the same as";
  return `${Math.abs(pct)}% ${pct > 0 ? "above" : "below"}`;
}

// "16 of 20 restaurants within 2 km list a price level: 3 at $, 10 at $$ and 3 at $$$. Typically $20–60 a
// person. Median household income here is about $197,000, 2.5 times the US figure of $80,000."
export function priceLine(p: PriceMix): string {
  const [, many] = NOUNS[p.category];
  const levels = p.byLevel.flatMap((n, level) => (n > 0 ? [`${n} at ${LEVEL_TEXT[level]}`] : []));
  const parts = [
    `${p.priced} of ${p.competitors} ${many} within ${formatDistance(COMPETITOR_RADIUS_M)} list a price level: ${joinList(levels)}.`,
  ];
  if (p.typicalRange) {
    const { min, max } = p.typicalRange;
    parts.push(`Typically ${max === null ? `${dollars(min)}+` : `${dollars(min)}–${max}`} a person.`);
  }
  if (p.medianIncome !== null) {
    const income = Math.round(p.medianIncome / 1000) * 1000;
    parts.push(
      `Median household income here is about ${dollars(income)}, ${incomeComparison(p.medianIncome, p.usMedianIncome)} the US figure of ${dollars(p.usMedianIncome)}.`,
    );
  }
  return parts.join(" ");
}
