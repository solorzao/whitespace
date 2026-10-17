// analyzeArea(): everything /api/analyze returns for a pin. Follows "How /api/analyze runs" in
// docs/ANALYSIS_PLAN.md, simplified for now:
// - The concept categories are the top 3 gaps by score. Gap types and poorly rated candidates come later.
// - generateConcepts doesn't read the success profiles yet, so it runs alongside the competitor search
//   and tagging instead of after them. Once it takes profiles, it has to wait for them.
// Relative imports only, so this also runs in the tsx scripts.

import type { AnalyzeResponse, Business, CategoryId, Concept, Gap, SourceDoc } from "../types";
import { COMPETITOR_RADIUS_M, collectArea, collectCompetitors, competitorsNotOnMap, type CollectResult } from "../ingest";
import { errorMessage } from "../ingest/http";
import { benchmarkFor } from "./benchmarks";
import { generateConcepts } from "./concepts";
import { scoreGaps } from "./gap-score";
import { buildProfile, profileReviews, type SuccessProfile } from "./profile";
import { tagReviews, type ReviewTag } from "./tag-reviews";

export const CONCEPT_COUNT = 3;

// Something that failed without stopping the analysis: a data source, or one of the steps below.
export type AnalysisIssue = {
  source: string; // "osm", "census", ... from collectArea, or "competitors", "tagging", "concepts"
  category?: CategoryId;
  message: string;
};

// AnalyzeResponse plus the fields docs/ANALYSIS_PLAN.md proposes ("Contract changes"). The extra fields
// move into types.ts once the team agrees on them; until then the UI can ignore them.
export type AnalysisResult = AnalyzeResponse & {
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
  const chosen = gaps.filter((g) => g.score > 0).slice(0, CONCEPT_COUNT);

  const [studies, concepts] = await Promise.all([
    Promise.all(chosen.map((g) => studyCompetitors(area, g.category, options.live ?? false, useClaude))),
    writeConcepts(area, chosen, useClaude),
  ]);

  const errors: AnalysisIssue[] = [
    ...area.errors,
    ...studies.flatMap((s) => s.errors),
    ...concepts.errors,
  ];
  const competitorDocs = studies.flatMap((s) => s.docs);
  const allCompetitors = uniqueById(studies.flatMap((s) => s.businesses));

  return {
    center: area.center,
    radiusM: area.radiusM,
    demographics: area.demographics,
    businesses: area.businesses,
    gaps,
    concepts: concepts.concepts,
    // The competitors' places: and review: records too, so profile evidence resolves and
    // follow-up answers can use them.
    docs: uniqueById([...area.docs, ...competitorDocs]),
    competitors: competitorsNotOnMap(area.businesses, allCompetitors),
    profiles: studies.flatMap((s) => (s.profile ? [s.profile] : [])),
    errors,
    from: area.from,
    demoArea: area.demoArea,
  };
}

type Study = {
  businesses: Business[];
  docs: SourceDoc[];
  profile: SuccessProfile | null;
  errors: AnalysisIssue[];
};

// Steps 4, 6 and 7 for one category: competitors within 2 km, their reviews tagged, the profile built.
// Never throws: if a step fails, the card renders without a success profile.
async function studyCompetitors(
  area: CollectResult,
  category: CategoryId,
  live: boolean,
  useClaude: boolean,
): Promise<Study> {
  const found = await collectCompetitors(category, area.center.lat, area.center.lng, COMPETITOR_RADIUS_M, { live });
  if (!found.ok) {
    return { businesses: [], docs: [], profile: null, errors: [{ source: "competitors", category, message: found.error }] };
  }
  const { businesses } = found.data;
  const reviews = found.docs.filter((d) => d.source === "review");
  // Only the top and bottom thirds' reviews count, so the middle third's aren't sent to Claude.
  const compared = profileReviews(businesses, reviews);

  let tags: ReviewTag[] = [];
  if (useClaude && compared.length > 0) {
    try {
      tags = await tagReviews(category, compared);
    } catch (error) {
      const issue: AnalysisIssue = { source: "tagging", category, message: errorMessage(error) };
      console.warn(`analyze: tagging ${category} failed: ${issue.message}`);
      return { businesses, docs: found.docs, profile: null, errors: [issue] };
    }
  }
  return { businesses, docs: found.docs, profile: buildProfile(category, businesses, reviews, tags), errors: [] };
}

// Step 8. Never throws: a failed call leaves the cards empty and says why in errors.
async function writeConcepts(
  area: CollectResult,
  chosen: Gap[],
  useClaude: boolean,
): Promise<{ concepts: Concept[]; errors: AnalysisIssue[] }> {
  if (!useClaude || chosen.length === 0) return { concepts: [], errors: [] };
  try {
    // Only the chosen gaps, so the cards' categories match the profiles'.
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
