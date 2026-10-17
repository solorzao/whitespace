// analyzeArea(): everything /api/analyze returns for a pin. Follows "How /api/analyze runs" in
// docs/ANALYSIS_PLAN.md, simplified for now:
// - The gap types need the 2 km competitors, so step 4 runs for every scored category before step 5
//   picks the concept categories (candidates.ts). Saved demo areas have them all on disk; a live pin
//   makes one Places call per scored category, up to 20.
// - generateConcepts doesn't read the success profiles yet, so it runs alongside the tagging instead
//   of after it. Once it takes profiles, it has to wait for them.
// Relative imports only, so this also runs in the tsx scripts.

import type { AnalyzeResponse, Business, CategoryId, Concept, SourceDoc } from "../types";
import { COMPETITOR_RADIUS_M, collectArea, collectCompetitors, competitorsNotOnMap, type CollectResult } from "../ingest";
import { errorMessage } from "../ingest/http";
import { benchmarkFor } from "./benchmarks";
import { pickConceptCategories, type CompetitorsByCategory, type ConceptCategory, type GapType } from "./candidates";
import { generateConcepts } from "./concepts";
import { scoreGaps } from "./gap-score";
import { buildProfile, type SuccessProfile } from "./profile";
import { tagReviews, type ReviewTag } from "./tag-reviews";

export { CONCEPT_COUNT } from "./candidates";

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
  errors: AnalysisIssue[];
  from: CollectResult["from"];
  demoArea?: string;
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

  const [studies, concepts] = await Promise.all([
    Promise.all(chosen.flatMap((c) => found.get(c.category) ?? []).map((f) => studyCompetitors(f, useClaude))),
    writeConcepts(area, chosen, useClaude),
  ]);
  const gapTypes = new Map(chosen.map((c) => [c.category, c.gapType]));

  const errors: AnalysisIssue[] = [
    ...area.errors,
    ...searches.flatMap((s) => s.errors),
    ...studies.flatMap((s) => s.errors),
    ...concepts.errors,
  ];
  // Only the concept categories' competitors go out, which keeps the response the size it was.
  const competitorDocs = chosen.flatMap((c) => found.get(c.category)?.docs ?? []);
  const allCompetitors = uniqueById(chosen.flatMap((c) => found.get(c.category)?.businesses ?? []));

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
    competitors: competitorsNotOnMap(area.businesses, allCompetitors),
    profiles: studies.flatMap((s) => (s.profile ? [s.profile] : [])),
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

type Study = {
  profile: SuccessProfile | null;
  errors: AnalysisIssue[];
};

// Steps 6 and 7 for one concept category: its competitors' reviews tagged, the profile built.
// Never throws: if tagging fails, the card renders without a success profile.
async function studyCompetitors({ category, businesses, docs }: Found, useClaude: boolean): Promise<Study> {
  const reviews = docs.filter((d) => d.source === "review");

  let tags: ReviewTag[] = [];
  if (useClaude && reviews.length > 0) {
    try {
      tags = await tagReviews(category, reviews);
    } catch (error) {
      const issue: AnalysisIssue = { source: "tagging", category, message: errorMessage(error) };
      console.warn(`analyze: tagging ${category} failed: ${issue.message}`);
      return { profile: null, errors: [issue] };
    }
  }
  return { profile: buildProfile(category, businesses, reviews, tags), errors: [] };
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
