// The shared contract from PROJECT_PLAN.md. Change it only with the whole team.

import type { CategoryId } from "./ingest/categories";

export type { CategoryId };

export type LatLng = { lat: number; lng: number };

export type SourceKind = "osm" | "census" | "places" | "review" | "wikipedia";

// One piece of evidence. Every source adapter returns these.
export type SourceDoc = {
  id: string; // "osm:node/123", "census:06075010200", "places:ChIJ...", "review:ChIJ...:0", "wikipedia:123"
  source: SourceKind;
  url: string; // link shown as the citation
  title: string;
  text: string; // what Claude reads
  lat?: number;
  lng?: number;
  category?: CategoryId;
};

// Combined for every tract whose center point is in the circle.
// Medians are population-weighted averages of the tract medians, so they are estimates.
export type Demographics = {
  tractFips: string[];
  population: number;
  medianIncome: number | null;
  medianAge: number | null;
  medianRent: number | null;
  pctRenters: number | null;
  pctWithKids: number | null;
  pctNoVehicle: number | null;
};

export type BusinessStatus = "open" | "closed_temporarily" | "closed_permanently";

export type Business = {
  id: string; // a SourceDoc id, so cards and citations can highlight the dot
  name: string;
  category: CategoryId;
  lat: number;
  lng: number;
  rating?: number;
  status?: BusinessStatus;
  url: string;
  // Every SourceDoc id for this business, when OSM and Places listings were merged into one dot:
  // ["osm:node/1", "places:ChIJ..."]. Reviews of it are "review:<place id>:<n>".
  docIds?: string[];
  // From Google Places, so set only for businesses Places returned (ANALYSIS_PLAN.md contract proposal).
  reviewCount?: number;
  priceLevel?: 0 | 1 | 2 | 3 | 4; // free to very expensive
  hours?: string[]; // Google's weekday descriptions
  closesAt?: number; // latest weekday closing time in hours: 21.5 = 9:30 pm, 25 = 1 am
  services?: BusinessServices; // only for the most-rated places in the circle and the 2 km competitors
};

export type BusinessServices = { delivery?: boolean; dineIn?: boolean; takeout?: boolean; reservable?: boolean };

export type Gap = {
  category: CategoryId;
  localPer1k: number;
  benchmarkPer1k: number;
  score: number;
};

export type Concept = {
  title: string;
  category: CategoryId;
  rationale: string;
  evidence: string[]; // SourceDoc ids
  risk: string;
};

export type AnalyzeRequest = LatLng;

export type AnalyzeResponse = {
  center: LatLng;
  radiusM: number;
  demographics: Demographics | null; // null outside the US
  businesses: Business[];
  gaps: Gap[];
  concepts: Concept[];
  docs: SourceDoc[];
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type AskRequest = {
  question: string;
  docs: SourceDoc[];
  history?: ChatTurn[];
};

export type Citation = { id: string; title: string; url: string };

export type AskResponse = {
  answer: string;
  citations: Citation[];
};

// What collectArea() returns. /api/analyze adds gaps and concepts to this.
export type AdapterError = { source: SourceKind; message: string };

export type AreaData = {
  center: LatLng;
  radiusM: number;
  businesses: Business[];
  demographics: Demographics | null;
  categoryCounts: Record<CategoryId, number>;
  docs: SourceDoc[];
  errors: AdapterError[];
};
