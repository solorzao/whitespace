// analyzeArea(): everything /api/analyze returns for a pin. Follows "How /api/analyze runs" in
// docs/ANALYSIS_PLAN.md, simplified for now:
// - The gap types need the 2 km competitors, so step 4 runs for every scored category before step 5
//   picks the concept categories (candidates.ts). Saved demo areas have them all on disk; a live pin
//   makes one Places call per scored category, up to 20.
// - generateConcepts doesn't read the success profiles yet, so it runs alongside the tagging instead
//   of after it. Once it takes profiles, it has to wait for them.
// - Each concept category also gets the card signals (signals.ts). The circle's own reviews get one
//   more tagging call, in parallel, so the popup can show "known for" and "complaints" lines (summaries.ts).
// Relative imports only, so this also runs in the tsx scripts.

import type { AnalyzeResponse, Business, CategoryId, Concept, SourceDoc } from "../types";
import { COMPETITOR_RADIUS_M, collectArea, collectCompetitors, competitorsNotOnMap, type CollectResult } from "../ingest";
import { errorMessage } from "../ingest/http";
import { findDuplicate } from "../ingest/places";
import { benchmarkFor } from "./benchmarks";
import { pickConceptCategories, type CompetitorsByCategory, type ConceptCategory, type GapType } from "./candidates";
import { generateConcepts } from "./concepts";
import { scoreGaps } from "./gap-score";
import { buildProfile, profileReviews, type SuccessProfile } from "./profile";
import {
  evidenceSize,
  nearestAndClosures,
  nearestLine,
  priceLine,
  priceMix,
  type EvidenceSize,
  type NearestAndClosures,
  type PriceMix,
} from "./signals";
import { summarizeBusinesses, type BusinessSummary } from "./summaries";
import { MAX_REVIEWS, tagReviews, type ReviewTag } from "./tag-reviews";

export { CONCEPT_COUNT } from "./candidates";
export { savedAnalysis } from "./saved";

// Something that failed without stopping the analysis: a data source, or one of the steps below.
export type AnalysisIssue = {
  source: string; // "osm", "census", ... from collectArea, or "competitors", "tagging", "concepts"
  category?: CategoryId;
  message: string;
};

// AnalyzeResponse plus the fields docs/ANALYSIS_PLAN.md proposes ("Contract changes"). The extra fields
// move into types.ts once the team agrees on them; until then the UI can ignore them.
export type AnalysisResult = Omit<AnalyzeResponse, "concepts"> & {
  concepts: (Concept & { gapType: GapType })[];
  conceptCategories: ConceptCategory[]; // the concept categories, strongest first, with their gap types and numbers
  competitors: Business[]; // Places businesses within 2 km for the concept categories, not already in businesses
  profiles: SuccessProfile[]; // one per concept category with enough reviewed competitors
  signals: CategorySignals[]; // one per concept category, in the same order
  summaries: BusinessSummary[]; // "known for" and "complaints" lines for businesses with tagged reviews
  errors: AnalysisIssue[];
  from: CollectResult["from"];
  demoArea?: string;
};

// The card's small signals for one concept category (signals.ts), with the lines that state them.
export type CategorySignals = {
  category: CategoryId;
  evidence: EvidenceSize; // how much data is behind the card; kept off the card, which never describes its method
  nearest: NearestAndClosures; // "No laundromat in the circle. The nearest is 1.4 km away, ..."
  price: PriceMix | null; // only when at least 4 competitors list a price level
  lines: string[]; // the card lines: nearest, then price
};

export type AnalyzeOptions = {
  live?: boolean; // skip the saved demo data
  claude?: boolean; // false skips both Claude calls: no concepts, and profiles from attributes only
};

// Throws AreaUnavailableError (from collectArea) when there's no business data at all.
export async function analyzeArea(lat: number, lng: number, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const useClaude = options.claude ?? true;
  const area = await collectArea(lat, lng, { live: options.live });
  // Outside the US there are no demographics, so no gaps, and the rest has nothing to work on.
  const gaps = scoreGaps(area, benchmarkFor(area.center));

  const searches = await Promise.all(gaps.map((g) => findCompetitors(area, g.category, options.live ?? false)));
  const found = new Map(searches.flatMap((s) => (s.found ? [[s.category, s.found] as const] : [])));
  const byCategory: CompetitorsByCategory = Object.fromEntries([...found].map(([c, f]) => [c, f.businesses]));
  const chosen = pickConceptCategories(area, gaps, byCategory);

  const [studies, circle, concepts] = await Promise.all([
    Promise.all(chosen.flatMap((c) => found.get(c.category) ?? []).map((f) => studyCompetitors(f, useClaude))),
    tagCircle(area, useClaude),
    writeConcepts(area, chosen, useClaude),
  ]);
  const gapTypes = new Map(chosen.map((c) => [c.category, c.gapType]));
  const profiles = studies.flatMap((s) => (s.profile ? [s.profile] : []));

  const errors: AnalysisIssue[] = [
    ...area.errors,
    ...searches.flatMap((s) => s.errors),
    ...studies.flatMap((s) => s.errors),
    ...circle.errors,
    ...concepts.errors,
  ];
  // Only the concept categories' competitors go out, which keeps the response the size it was.
  const competitorDocs = chosen.flatMap((c) => found.get(c.category)?.docs ?? []);
  const allCompetitors = uniqueById(chosen.flatMap((c) => found.get(c.category)?.businesses ?? []));

  const signals = chosen.map(({ category }): CategorySignals => {
    const set = found.get(category) ?? null;
    const evidence = evidenceSize(category, area, set, profiles.find((p) => p.category === category) ?? null);
    const nearest = nearestAndClosures(category, area, set?.businesses ?? null);
    const price = priceMix(category, area.demographics, set?.businesses ?? []);
    return {
      category,
      evidence,
      nearest,
      price,
      lines: [nearestLine(nearest), ...(price ? [priceLine(price)] : [])],
    };
  });
  const competitors = competitorsNotOnMap(area.businesses, allCompetitors);
  // A competitor that is also on the map (same places id, or an OSM business with its name nearby) is
  // summarized under the map business's id, which is the dot the popup opens.
  const onMap = allCompetitors.flatMap((c) => {
    const dot = competitors.includes(c) ? null : findDuplicate(area.businesses, c);
    return dot ? [{ id: dot.id, docIds: [c.id] }] : [];
  });
  const summaries = summarizeBusinesses(
    [...area.businesses, ...onMap, ...competitors],
    [...circle.tagged, ...studies.flatMap((s) => s.tagged)],
    [...circle.tags, ...studies.flatMap((s) => s.tags)],
  );

  return {
    center: area.center,
    radiusM: area.radiusM,
    demographics: area.demographics,
    businesses: area.businesses,
    gaps,
    concepts: concepts.concepts.map((c) => ({ ...c, gapType: gapTypes.get(c.category)! })),
    // The competitors' places: and review: records too, so profile evidence resolves and
    // follow-up answers can use them.
    docs: uniqueById([...area.docs, ...competitorDocs]),
    conceptCategories: chosen,
    competitors,
    profiles,
    signals,
    summaries,
    errors,
    from: area.from,
    demoArea: area.demoArea,
  };
}

type Found = { category: CategoryId; businesses: Business[]; docs: SourceDoc[] };

// Step 4 for one category: competitors within 2 km. Never throws: without them, the category can
// still be unserved, and its card renders without a success profile.
async function findCompetitors(
  area: CollectResult,
  category: CategoryId,
  live: boolean,
): Promise<{ category: CategoryId; found: Found | null; errors: AnalysisIssue[] }> {
  const result = await collectCompetitors(category, area.center.lat, area.center.lng, COMPETITOR_RADIUS_M, { live });
  if (!result.ok) return { category, found: null, errors: [{ source: "competitors", category, message: result.error }] };
  return { category, found: { category, businesses: result.data.businesses, docs: result.docs }, errors: [] };
}

// The reviews sent to tagging (including any that got no tags) and the tags that came back.
type Tagged = { tagged: SourceDoc[]; tags: ReviewTag[]; errors: AnalysisIssue[] };

type Study = Tagged & { profile: SuccessProfile | null };

// The circle's own reviews (Places reviews of businesses on the map), tagged in one call for the
// popup's "known for" and "complaints" lines. Never throws: on failure the popup has no lines.
async function tagCircle(area: CollectResult, useClaude: boolean): Promise<Tagged> {
  const reviews = area.docs.filter((d) => d.source === "review").slice(0, MAX_REVIEWS);
  if (!useClaude || reviews.length === 0) return { tagged: [], tags: [], errors: [] };
  try {
    return { tagged: reviews, tags: await tagReviews(null, reviews), errors: [] };
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`analyze: tagging the circle's reviews failed: ${message}`);
    return { tagged: [], tags: [], errors: [{ source: "tagging", message }] };
  }
}

// Steps 6 and 7 for one concept category: its competitors' reviews tagged, the profile built.
// Never throws: if tagging fails, the card renders without a success profile.
async function studyCompetitors({ category, businesses, docs }: Found, useClaude: boolean): Promise<Study> {
  const reviews = docs.filter((d) => d.source === "review");
  // Only the top and bottom thirds' reviews count, so the middle third's aren't sent to Claude.
  // Those middle-third competitors get no "known for" lines either.
  const compared = profileReviews(businesses, reviews).slice(0, MAX_REVIEWS);

  let tags: ReviewTag[] = [];
  if (useClaude && compared.length > 0) {
    try {
      tags = await tagReviews(category, compared);
    } catch (error) {
      const issue: AnalysisIssue = { source: "tagging", category, message: errorMessage(error) };
      console.warn(`analyze: tagging ${category} failed: ${issue.message}`);
      return { profile: null, tagged: [], tags: [], errors: [issue] };
    }
  }
  const tagged = useClaude ? compared : [];
  return { profile: buildProfile(category, businesses, reviews, tags), tagged, tags, errors: [] };
}

// Step 8. Never throws: a failed call leaves the cards empty and says why in errors.
async function writeConcepts(
  area: CollectResult,
  chosen: ConceptCategory[],
  useClaude: boolean,
): Promise<{ concepts: Concept[]; errors: AnalysisIssue[] }> {
  if (!useClaude || chosen.length === 0) return { concepts: [], errors: [] };
  try {
    // Only the concept categories, with their gap types, so the cards' categories match the profiles'.
    return { concepts: await generateConcepts(area, chosen), errors: [] };
  } catch (error) {
    const message = errorMessage(error);
    console.error(`analyze: concepts failed: ${message}`);
    return { concepts: [], errors: [{ source: "concepts", message }] };
  }
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
