// The search menu's ready-made questions, each tied to a place. scripts/save-suggestions.ts runs the
// analysis for each place and answers each question ahead of time, and GET /api/suggestions/<id> serves
// the saved thread, so clicking a suggestion opens it with no wait. Client-safe: no Node imports.

import { DEMO_AREAS } from "../ingest/demo-areas";
import type { LatLng } from "../types";

// A demo area's slug reuses its saved analysis (data/demo/<slug>-analysis.json); any other place has
// its own, data/suggestions/<slug>-analysis.json.
export type SuggestionPlace = { slug: string; name: string; center: LatLng };

export type Suggestion = {
  id: string; // stable: the saved answer and the browser's thread are keyed by it
  question: string;
  place: SuggestionPlace;
};

const demo = (slug: string): SuggestionPlace => {
  const area = DEMO_AREAS.find((a) => a.slug === slug);
  if (!area) throw new Error(`Unknown demo area ${slug}`);
  return area;
};

const SANTA_MONICA = demo("santa-monica");
const LOWER_MANHATTAN = demo("lower-manhattan");

export const SUGGESTION_PLACES: SuggestionPlace[] = [SANTA_MONICA, LOWER_MANHATTAN];

export const SUGGESTIONS: Suggestion[] = [
  {
    id: "santa-monica-late-pharmacy",
    question: "Would a late-night pharmacy do well near the Third Street Promenade?",
    place: SANTA_MONICA,
  },
  {
    id: "santa-monica-fast-food-complaints",
    question: "What do reviewers complain about at the fast food places around Santa Monica Place?",
    place: SANTA_MONICA,
  },
  {
    id: "santa-monica-residents",
    question: "Who lives in downtown Santa Monica, and what does that mean for a new business?",
    place: SANTA_MONICA,
  },
  {
    id: "santa-monica-best-restaurants",
    question: "Which restaurants near the Promenade have the strongest reviews, and why?",
    place: SANTA_MONICA,
  },
  {
    id: "lower-manhattan-late-laundromat",
    question: "Is there room for a laundromat open past 9 pm in the Financial District?",
    place: LOWER_MANHATTAN,
  },
  {
    id: "lower-manhattan-pharmacy-reviews",
    question: "What do reviews say about the pharmacies around Wall Street?",
    place: LOWER_MANHATTAN,
  },
  {
    id: "lower-manhattan-convenience",
    question: "What could a new convenience store near Wall Street do better than the ones there now?",
    place: LOWER_MANHATTAN,
  },
  {
    id: "lower-manhattan-residents",
    question: "Who lives in the Financial District, and how do they get around?",
    place: LOWER_MANHATTAN,
  },
];

export function findSuggestion(id: string): Suggestion | null {
  return SUGGESTIONS.find((s) => s.id === id) ?? null;
}

// The id of the suggestion's thread in the browser's history, so opening it again reopens that thread.
export const threadId = (suggestionId: string) => `suggestion-${suggestionId}`;
