// Google Places (New): popular businesses with ratings and status, plus reviews for the most-rated ones.

import type { Business, BusinessStatus, SourceDoc } from "../types";
import {
  CATEGORY_LABELS,
  PLACES_EXCLUDED_PRIMARY_TYPES,
  PLACES_INCLUDED_TYPES,
  categorizeGoogle,
} from "./categories";
import { distanceM } from "./geo";
import { fetchJson } from "./http";
import { settle, type AdapterResult } from "./result";

const API = "https://places.googleapis.com/v1";
const MAX_RESULTS = 20; // the most Nearby Search returns
const REVIEWED_PLACES = 8;
const MERGE_DISTANCE_M = 50;

const NEARBY_FIELDS = [
  "id",
  "displayName",
  "types",
  "primaryType",
  "location",
  "rating",
  "userRatingCount",
  "businessStatus",
  "googleMapsUri",
].map((f) => `places.${f}`);

export type Place = {
  id: string;
  displayName?: { text: string };
  types?: string[];
  primaryType?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
  googleMapsUri?: string;
};

export type Review = {
  rating?: number;
  relativePublishTimeDescription?: string;
  text?: { text: string };
  authorAttribution?: { displayName?: string };
  googleMapsUri?: string;
};

export type PlacesData = { businesses: Business[] };

const STATUS: Record<NonNullable<Place["businessStatus"]>, BusinessStatus> = {
  OPERATIONAL: "open",
  CLOSED_TEMPORARILY: "closed_temporarily",
  CLOSED_PERMANENTLY: "closed_permanently",
};

const STATUS_TEXT: Record<BusinessStatus, string> = {
  open: "open",
  closed_temporarily: "temporarily closed",
  closed_permanently: "permanently closed",
};

function headers(key: string, fields: string[]) {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": key,
    "X-Goog-FieldMask": fields.join(","),
  };
}

export type NearbySearch = {
  lat: number;
  lng: number;
  radiusM: number;
  includedTypes?: string[];
  // Only places whose main type is one of these. Stricter than includedTypes, which also matches
  // a furniture store that lists home_improvement_store among its types.
  includedPrimaryTypes?: string[];
  rankPreference?: "POPULARITY" | "DISTANCE";
};

export async function searchNearby(search: NearbySearch, key: string): Promise<Place[]> {
  const { lat, lng, radiusM, includedTypes = PLACES_INCLUDED_TYPES, includedPrimaryTypes, rankPreference = "POPULARITY" } =
    search;
  const types = includedPrimaryTypes
    ? { includedPrimaryTypes }
    : { includedTypes, excludedPrimaryTypes: PLACES_EXCLUDED_PRIMARY_TYPES };
  const res = await fetchJson<{ places?: Place[] }>(`${API}/places:searchNearby`, {
    method: "POST",
    headers: headers(key, NEARBY_FIELDS),
    body: JSON.stringify({
      ...types,
      maxResultCount: MAX_RESULTS,
      rankPreference,
      languageCode: "en",
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
    }),
    timeoutMs: 15_000,
  });
  return res.places ?? [];
}

// One failed details call loses that place's reviews, not the whole adapter.
export async function fetchReviews(placeId: string, key: string): Promise<Review[]> {
  try {
    const res = await fetchJson<{ reviews?: Review[] }>(`${API}/places/${placeId}?languageCode=en`, {
      headers: headers(key, ["id", "reviews"]),
      timeoutMs: 15_000,
    });
    return res.reviews ?? [];
  } catch {
    return [];
  }
}

export type Parsed = { business: Business; ratingCount: number };

export function parsePlace(place: Place): Parsed | null {
  const name = place.displayName?.text;
  const category = categorizeGoogle(place.types ?? [], place.primaryType);
  if (!name || !place.location || !category) return null;
  return {
    business: {
      id: `places:${place.id}`,
      name,
      category,
      lat: place.location.latitude,
      lng: place.location.longitude,
      rating: place.rating,
      status: place.businessStatus ? STATUS[place.businessStatus] : undefined,
      url: place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${place.id}`,
    },
    ratingCount: place.userRatingCount ?? 0,
  };
}

// note adds a sentence, such as how far the place is from the pin.
export function placeDoc({ business: b, ratingCount }: Parsed, note?: string): SourceDoc {
  const parts = [`${b.name} is a ${CATEGORY_LABELS[b.category].toLowerCase()} business on Google Maps.`];
  if (b.rating !== undefined) parts.push(`Rated ${b.rating} out of 5 from ${ratingCount.toLocaleString("en-US")} ratings.`);
  if (b.status) parts.push(`Status: ${STATUS_TEXT[b.status]}.`);
  if (note) parts.push(note);
  return { id: b.id, source: "places", url: b.url, title: b.name, text: parts.join(" "), lat: b.lat, lng: b.lng, category: b.category };
}

export function reviewDocs(b: Business, reviews: Review[]): SourceDoc[] {
  const placeId = placeIdOf(b);
  return reviews
    .filter((r) => r.text?.text)
    .map((r, n) => {
      const meta = [
        r.rating !== undefined ? `${r.rating} out of 5` : null,
        r.authorAttribution?.displayName ? `by ${r.authorAttribution.displayName}` : null,
        r.relativePublishTimeDescription ?? null,
      ].filter(Boolean);
      return {
        id: `review:${placeId}:${n}`,
        source: "review" as const,
        url: r.googleMapsUri ?? b.url,
        title: `Review of ${b.name}`,
        text: `Google review of ${b.name} (${meta.join(", ")}): ${r.text!.text}`,
        lat: b.lat,
        lng: b.lng,
        category: b.category,
      };
    });
}

export const placeIdOf = (b: Business) => b.id.slice("places:".length);

// Google Places calls are billed, so they're off unless PLACES_LIVE=1. With them off, the demo areas
// still have ratings and reviews from their saved files, and other pins get OSM, Census and Wikipedia
// only. The ingest-demo script turns them on for itself.
export function livePlacesEnabled(): boolean {
  return process.env.PLACES_LIVE === "1";
}

export const PLACES_OFF_MESSAGE =
  "Live Google Places calls are off (PLACES_LIVE isn't 1), so ratings and reviews are only available near the demo areas.";

export function placesKey(): string {
  if (!livePlacesEnabled()) throw new Error(PLACES_OFF_MESSAGE);
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  return key;
}

export function fetchPlaces(lat: number, lng: number, radiusM: number): Promise<AdapterResult<PlacesData>> {
  return settle<PlacesData>(async () => {
    const key = placesKey();
    const parsed = (await searchNearby({ lat, lng, radiusM }, key)).map(parsePlace).filter((p) => p !== null);
    const mostRated = [...parsed].sort((a, b) => b.ratingCount - a.ratingCount).slice(0, REVIEWED_PLACES);
    const reviews = await Promise.all(
      mostRated.map(async (p) => reviewDocs(p.business, await fetchReviews(placeIdOf(p.business), key))),
    );

    return {
      docs: [...parsed.map((p) => placeDoc(p)), ...reviews.flat()],
      data: { businesses: parsed.map((p) => p.business) },
    };
  });
}

// Lowercase, no accents, no punctuation, no leading "the", and "&" read as "and".
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

// Same name, or one name starts the other ("Vons" and "Vons Pharmacy").
export function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.startsWith(`${short} `);
}

// Fold each Places business into the nearest OSM business with a matching name within 50 m,
// so the map doesn't show two dots for one business. The merged business keeps its OSM id
// (category counts come from OSM) and takes the rating and status from Places.
// Places businesses with no match are added as they are.
export function mergeBusinesses(osm: Business[], places: Business[]): Business[] {
  const merged = osm.map((b) => ({ ...b }));
  for (const p of places) {
    let best: Business | null = null;
    let bestDistance = MERGE_DISTANCE_M;
    for (const o of merged) {
      if (!o.id.startsWith("osm:") || o.docIds?.some((id) => id.startsWith("places:"))) continue;
      const d = distanceM(o, p);
      if (d <= bestDistance && namesMatch(o.name, p.name)) {
        best = o;
        bestDistance = d;
      }
    }
    if (best) {
      best.rating = p.rating;
      best.status = p.status;
      best.docIds = [best.id, p.id];
    } else {
      merged.push({ ...p });
    }
  }
  return merged;
}
