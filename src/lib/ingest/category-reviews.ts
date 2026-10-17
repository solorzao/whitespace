// Reviews for one category, fetched for the business being evaluated rather than for the area's most popular places.
// The general reviews (places.ts) come from the 8 most-rated places, mostly restaurants and bars; these come
// from the competitors of the category in question, looking past the circle when there are few inside it.

import type { AreaData, Business, CategoryId, LatLng, SourceDoc } from "../types";
import { CATEGORY_IDS, CATEGORY_LABELS, googleTypesFor } from "./categories";
import { AREA_RADIUS_M, findDemoArea } from "./demo-areas";
import { distanceM } from "./geo";
import { errorMessage } from "./http";
import {
  fetchReviews,
  mergeBusinesses,
  parsePlace,
  placeDoc,
  placeIdOf,
  placesKey,
  reviewDocs,
  searchNearby,
  type Parsed,
} from "./places";
import { categoryReviewsFilePath, readSaved } from "./saved";

// Fewer competitors than this inside the circle, and the search widens.
const MIN_COMPETITORS = 3;
const WIDE_RADIUS_M = 2000;
const REVIEWED_COMPETITORS = 5; // up to 5 reviews each

export type Competitor = {
  id: string; // places:<id>, matching its SourceDoc
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  inArea: boolean; // inside the 800 m circle
  rating?: number;
  ratingCount: number;
  status?: Business["status"];
  url: string;
};

export type CategoryReviews = {
  category: CategoryId;
  center: LatLng;
  searchedRadiusM: number; // 800, or 2000 when the search widened
  competitors: Competitor[]; // inside the circle by rating count, then outside by distance
  docs: SourceDoc[]; // places: docs for every competitor, then review: docs
};

// What ingest-demo.ts saves next to each demo area.
export type SavedCategoryReviews = Partial<Record<CategoryId, CategoryReviews>>;

const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

function distanceNote(c: Competitor): string {
  const where = c.inArea ? "inside" : "outside";
  return `It is ${formatDistance(c.distanceM)} from the pin, ${where} the ${AREA_RADIUS_M} m area.`;
}

function stripParsed(c: Competitor & { parsed: Parsed }): Competitor {
  const { id, name, lat, lng, distanceM, inArea, rating, ratingCount, status, url } = c;
  return { id, name, lat, lng, distanceM, inArea, rating, ratingCount, status, url };
}

// Calls Google live. Throws if the search itself fails; a failed review fetch only loses that place's reviews.
export async function fetchCategoryReviews(center: LatLng, category: CategoryId): Promise<CategoryReviews> {
  const key = placesKey();
  // By primary type, so the 20 results go to businesses of this category rather than to places that
  // merely list one of its types. This misses some specific subtypes, such as italian_restaurant.
  const includedPrimaryTypes = googleTypesFor(category);
  const search = async (radiusM: number, rankPreference: "POPULARITY" | "DISTANCE") =>
    (await searchNearby({ ...center, radiusM, includedPrimaryTypes, rankPreference }, key))
      .map(parsePlace)
      .filter((p): p is Parsed => p !== null && p.business.category === category);

  let found = await search(AREA_RADIUS_M, "POPULARITY");
  let searchedRadiusM = AREA_RADIUS_M;
  if (found.length < MIN_COMPETITORS) {
    // Few or none nearby: the nearest ones outside the circle, and how far away they are, are evidence too.
    const seen = new Set(found.map((p) => p.business.id));
    found = [...found, ...(await search(WIDE_RADIUS_M, "DISTANCE")).filter((p) => !seen.has(p.business.id))];
    searchedRadiusM = WIDE_RADIUS_M;
  }

  const competitors: (Competitor & { parsed: Parsed })[] = found.map((parsed) => {
    const b = parsed.business;
    const d = distanceM(center, b);
    return {
      id: b.id,
      name: b.name,
      lat: b.lat,
      lng: b.lng,
      distanceM: Math.round(d),
      inArea: d <= AREA_RADIUS_M,
      rating: b.rating,
      ratingCount: parsed.ratingCount,
      status: b.status,
      url: b.url,
      parsed,
    };
  });
  competitors.sort((a, b) =>
    a.inArea !== b.inArea ? (a.inArea ? -1 : 1) : a.inArea ? b.ratingCount - a.ratingCount : a.distanceM - b.distanceM,
  );

  // The most-rated competitors in the circle, then the nearest outside it. Permanently closed places
  // still count as competitors that failed, but their reviews are less useful than open ones.
  const reviewed = competitors.filter((c) => c.status !== "closed_permanently").slice(0, REVIEWED_COMPETITORS);
  const reviews = await Promise.all(
    reviewed.map(async (c) => reviewDocs(c.parsed.business, await fetchReviews(placeIdOf(c.parsed.business), key))),
  );

  return {
    category,
    center,
    searchedRadiusM,
    competitors: competitors.map(stripParsed),
    docs: [...competitors.map((c) => placeDoc(c.parsed, distanceNote(c))), ...reviews.flat()],
  };
}

export type CategoryReviewsOptions = {
  live?: boolean; // skip the saved demo data
};

// Saved data for a pin near a demo center, otherwise a live fetch. Same snapping as collectArea.
export async function getCategoryReviews(
  lat: number,
  lng: number,
  category: CategoryId,
  options: CategoryReviewsOptions = {},
): Promise<CategoryReviews> {
  const demo = options.live ? null : findDemoArea({ lat, lng });
  if (demo) {
    const saved = await readSaved<SavedCategoryReviews>(categoryReviewsFilePath(demo));
    const hit = saved?.[category];
    if (hit) return hit;
    return fetchCategoryReviews(demo.center, category);
  }
  return fetchCategoryReviews({ lat, lng }, category);
}

// Several categories at once, for /api/analyze. Never throws: a failed category is reported in errors.
export async function collectCategoryReviews(
  lat: number,
  lng: number,
  categories: CategoryId[],
  options: CategoryReviewsOptions = {},
): Promise<{ results: CategoryReviews[]; errors: { category: CategoryId; message: string }[] }> {
  const settled = await Promise.allSettled(categories.map((c) => getCategoryReviews(lat, lng, c, options)));
  const results: CategoryReviews[] = [];
  const errors: { category: CategoryId; message: string }[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") results.push(s.value);
    else errors.push({ category: categories[i], message: errorMessage(s.reason) });
  });
  return { results, errors };
}

export type AddCategoryReviewsOptions = {
  reviewsPerCategory?: number;
};

// Adds category reviews to an area before generateConcepts. The concepts prompt reads the first 30
// review docs, so up to 8 reviews per category go ahead of the general reviews. Competitors inside the
// circle that aren't on the map yet are added as businesses (merged with OSM by name, as usual).
// Category counts are left alone: they come from OpenStreetMap only.
export function addCategoryReviews(
  area: AreaData,
  results: CategoryReviews[],
  { reviewsPerCategory = 8 }: AddCategoryReviewsOptions = {},
): AreaData {
  const known = new Set(area.docs.map((d) => d.id));
  const take = (docs: SourceDoc[]) =>
    docs.filter((d) => {
      if (known.has(d.id)) return false;
      known.add(d.id);
      return true;
    });

  // Reviews already in the area (from the general Places fetch) still move to the front.
  const priorityReviews = results.flatMap((r) => r.docs.filter((d) => d.source === "review").slice(0, reviewsPerCategory));
  const priorityIds = new Set(priorityReviews.map((d) => d.id));
  const rest = area.docs.filter((d) => !priorityIds.has(d.id));
  priorityReviews.forEach((d) => known.add(d.id));
  const placeDocs = take(results.flatMap((r) => r.docs.filter((d) => d.source === "places")));

  const onMap = new Set(area.businesses.flatMap((b) => [b.id, ...(b.docIds ?? [])]));
  const newCompetitors: Business[] = results
    .flatMap((r) => r.competitors.filter((c) => c.inArea && !onMap.has(c.id)).map((c) => ({ ...c, category: r.category })))
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      lat: c.lat,
      lng: c.lng,
      rating: c.rating,
      status: c.status,
      url: c.url,
    }));

  return {
    ...area,
    businesses: mergeBusinesses(area.businesses, newCompetitors),
    docs: [...priorityReviews, ...rest, ...placeDocs],
  };
}

// A line Claude can read before the documents: how many competitors, and how close.
export function summarize(r: CategoryReviews): string {
  const label = CATEGORY_LABELS[r.category].toLowerCase();
  const inside = r.competitors.filter((c) => c.inArea);
  const outside = r.competitors.filter((c) => !c.inArea);
  const parts = [
    `Google Maps lists ${inside.length} ${label} ${inside.length === 1 ? "business" : "businesses"} within ${AREA_RADIUS_M} m of the pin${inside.length === 20 ? " (the most one search returns)" : ""}.`,
  ];
  if (r.searchedRadiusM > AREA_RADIUS_M) {
    parts.push(
      outside.length
        ? `The nearest outside the area is ${outside[0].name}, ${formatDistance(outside[0].distanceM)} away.`
        : `There are none within ${formatDistance(r.searchedRadiusM)} either.`,
    );
  }
  return parts.join(" ");
}

// A tool for the /api/ask Claude call, in the Messages API tool format.
export const CATEGORY_REVIEWS_TOOL = {
  name: "get_category_reviews",
  description:
    "Get Google Maps competitors and their reviews for one business category around the pin. Use it when the question is about opening, or the demand for, a kind of business and the documents don't already include reviews of that kind of business. It returns how many competitors are inside the 800 m area, the nearest ones outside it when there are few, and up to 25 reviews, as documents you can cite by id.",
  input_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: CATEGORY_IDS,
        description: "The business category to look up.",
      },
    },
    required: ["category"],
    additionalProperties: false,
  },
};

export type CategoryReviewsToolResult = {
  text: string; // the tool_result content for Claude
  docs: SourceDoc[]; // add these to the docs used to resolve citations, and return them to the client
  isError: boolean;
};

// Runs CATEGORY_REVIEWS_TOOL. Never throws: a failure becomes an error result Claude can explain.
export async function runCategoryReviewsTool(
  input: unknown,
  center: LatLng,
  options: CategoryReviewsOptions = {},
): Promise<CategoryReviewsToolResult> {
  const category = (input as { category?: unknown } | null)?.category;
  if (typeof category !== "string" || !CATEGORY_IDS.includes(category as CategoryId)) {
    return { text: `Unknown category. Use one of: ${CATEGORY_IDS.join(", ")}.`, docs: [], isError: true };
  }
  try {
    const r = await getCategoryReviews(center.lat, center.lng, category as CategoryId, options);
    // Same line format as the documents block in the first message.
    const lines = r.docs.map(({ id, source, title, text }) => JSON.stringify({ id, source, title, text }));
    return { text: `${summarize(r)}\n<documents>\n${lines.join("\n")}\n</documents>`, docs: r.docs, isError: false };
  } catch (err) {
    return { text: `Couldn't get ${category} reviews: ${errorMessage(err)}`, docs: [], isError: true };
  }
}
