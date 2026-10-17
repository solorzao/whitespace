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
// Residential neighborhoods whose OpenStreetMap, Census and Wikipedia data showed clear gaps.
const LOGAN_SQUARE = { slug: "logan-square-chicago", name: "Logan Square, Chicago", center: { lat: 41.9231, lng: -87.7093 } };
const BED_STUY = { slug: "bed-stuy-brooklyn", name: "Bed-Stuy, Brooklyn", center: { lat: 40.6872, lng: -73.9418 } };
const MISSION = { slug: "mission-district-sf", name: "Mission District, San Francisco", center: { lat: 37.7599, lng: -122.4148 } };
const ALBERTA = { slug: "alberta-arts-portland", name: "Alberta Arts District, Portland", center: { lat: 45.559, lng: -122.6461 } };
const MONTROSE = { slug: "montrose-houston", name: "Montrose, Houston", center: { lat: 29.746, lng: -95.39 } };
const LITTLE_HAVANA = { slug: "little-havana-miami", name: "Little Havana, Miami", center: { lat: 25.768, lng: -80.22 } };

export const SUGGESTION_PLACES: SuggestionPlace[] = [
  SANTA_MONICA,
  LOWER_MANHATTAN,
  LOGAN_SQUARE,
  BED_STUY,
  MISSION,
  ALBERTA,
  MONTROSE,
  LITTLE_HAVANA,
];

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
  { id: "logan-square-gym", question: "Is there room for a gym in Logan Square?", place: LOGAN_SQUARE },
  {
    id: "logan-square-loved",
    question: "Which Logan Square businesses do reviewers love, and what do they have in common?",
    place: LOGAN_SQUARE,
  },
  {
    id: "bed-stuy-pharmacies",
    question: "Does Bed-Stuy have enough pharmacies for everyone who lives here?",
    place: BED_STUY,
  },
  { id: "bed-stuy-daycare", question: "Would a daycare do well in Bed-Stuy?", place: BED_STUY },
  {
    id: "mission-restaurant-prices",
    question: "How pricey are restaurants in the Mission, and is there room for a cheaper option?",
    place: MISSION,
  },
  {
    id: "mission-opportunity",
    question: "What's the biggest business opportunity in the Mission District?",
    place: MISSION,
  },
  { id: "alberta-laundromat", question: "Would a laundromat do well in the Alberta Arts District?", place: ALBERTA },
  {
    id: "alberta-family-cafe",
    question: "Would a family-friendly café do well in the Alberta Arts District?",
    place: ALBERTA,
  },
  { id: "montrose-grocery", question: "Could a neighborhood grocery store make it in Montrose?", place: MONTROSE },
  {
    id: "montrose-bakery-deli",
    question: "Is there room for a bakery or deli in Montrose?",
    place: MONTROSE,
  },
  {
    id: "little-havana-missing",
    question: "What everyday businesses is Little Havana missing?",
    place: LITTLE_HAVANA,
  },
  {
    id: "little-havana-pricing",
    question: "How should a new business in Little Havana set its prices?",
    place: LITTLE_HAVANA,
  },
];

export function findSuggestion(id: string): Suggestion | null {
  return SUGGESTIONS.find((s) => s.id === id) ?? null;
}

// The id of the suggestion's thread in the browser's history, so opening it again reopens that thread.
export const threadId = (suggestionId: string) => `suggestion-${suggestionId}`;
