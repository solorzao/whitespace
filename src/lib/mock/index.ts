// Sample responses for building the UI without API keys or live calls.
// mockAnalysis is the saved Santa Monica analysis (scripts/save-demo-analysis.ts), so it has every field
// the real /api/analyze returns. mockAnswer is made up.

import savedSantaMonica from "../../../data/demo/santa-monica-analysis.json";
import type { AnalysisResult } from "../analysis";
import type { AskResponse, LatLng, SourceDoc } from "../types";

// Set WHITESPACE_MOCK=1 to serve these from /api/analyze and /api/ask. CI's e2e run sets it.
export function useMocks(): boolean {
  return process.env.WHITESPACE_MOCK === "1";
}

// The JSON's inferred type has plain strings where AnalysisResult has unions.
const ANALYSIS = savedSantaMonica as unknown as AnalysisResult;

// The sample is centered on the Santa Monica demo area; shift it so the dots surround any pin.
export function mockAnalysis(point: LatLng): AnalysisResult {
  const dLat = point.lat - ANALYSIS.center.lat;
  const dLng = point.lng - ANALYSIS.center.lng;
  const shift = <T extends { lat?: number; lng?: number }>(item: T): T =>
    item.lat === undefined || item.lng === undefined
      ? item
      : { ...item, lat: item.lat + dLat, lng: item.lng + dLng };
  return {
    ...ANALYSIS,
    center: point,
    businesses: ANALYSIS.businesses.map(shift),
    competitors: ANALYSIS.competitors.map(shift),
    docs: ANALYSIS.docs.map(shift),
  };
}

// Answers mark citations inline as [1], [2], ..., numbered in the order of `citations`.
export function mockAnswer(question: string, docs: SourceDoc[]): AskResponse {
  const pick = (source: SourceDoc["source"]) => docs.find((d) => d.source === source);
  const cited = [pick("census"), pick("review")].filter((d): d is SourceDoc => d !== undefined);
  return {
    answer:
      `This is a sample answer to "${question}". ` +
      (cited.length === 2
        ? "Most households in the area rent [1], and a nearby reviewer says they drive across town to do laundry [2]."
        : "A walkable, everyday service usually does well in a dense neighborhood like this one."),
    citations: cited.map(({ id, title, url }) => ({ id, title, url })),
  };
}
