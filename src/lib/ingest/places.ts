// Google Places (New): popular businesses with ratings, status, price level and hours, plus reviews and
// service options for the most-rated ones. competitors.ts reuses these helpers for the 2 km search.

import type { Business, BusinessServices, BusinessStatus, SourceDoc } from "../types";
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

// Billing: rating, userRatingCount, priceLevel and regularOpeningHours put Nearby Search on the
// Enterprise SKU. reviews and the service options are Enterprise + Atmosphere, on Nearby Search
// or Place Details alike. Checked against Google's docs on 2026-10-17.
const PLACE_FIELDS = [
  "id",
  "displayName",
  "types",
  "primaryType",
  "location",
  "rating",
  "userRatingCount",
  "businessStatus",
  "googleMapsUri",
  "priceLevel",
  "regularOpeningHours",
];
export const SERVICE_FIELDS = ["delivery", "dineIn", "takeout", "reservable"] as const;
export const ATMOSPHERE_FIELDS = ["reviews", ...SERVICE_FIELDS];

type Weekday = { day: number; hour: number; minute: number };

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
  priceLevel?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[]; periods?: { open: Weekday; close?: Weekday }[] };
  reviews?: Review[];
  delivery?: boolean;
  dineIn?: boolean;
  takeout?: boolean;
  reservable?: boolean;
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

const PRICE_LEVEL: Record<string, NonNullable<Business["priceLevel"]>> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

const PRICE_TEXT = ["free", "inexpensive ($)", "moderate ($$)", "expensive ($$$)", "very expensive ($$$$)"];

const SERVICE_TEXT: Record<keyof BusinessServices, string> = {
  delivery: "delivery",
  dineIn: "dine-in",
  takeout: "takeout",
  reservable: "reservations",
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
  // Also return reviews and service options, which moves the call to the Enterprise + Atmosphere SKU.
  withAtmosphere?: boolean;
};

export async function searchNearby(search: NearbySearch, key: string): Promise<Place[]> {
  const { lat, lng, radiusM, includedTypes = PLACES_INCLUDED_TYPES, includedPrimaryTypes, rankPreference = "POPULARITY" } =
    search;
  const types = includedPrimaryTypes
    ? { includedPrimaryTypes }
    : { includedTypes, excludedPrimaryTypes: PLACES_EXCLUDED_PRIMARY_TYPES };
  const fields = [...PLACE_FIELDS, ...(search.withAtmosphere ? ATMOSPHERE_FIELDS : [])].map((f) => `places.${f}`);
  const res = await fetchJson<{ places?: Place[] }>(`${API}/places:searchNearby`, {
    method: "POST",
    headers: headers(key, fields),
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

type Details = Pick<Place, "reviews" | "delivery" | "dineIn" | "takeout" | "reservable">;

// Reviews and service options. One failed call loses that place's details, not the whole adapter.
async function fetchDetails(placeId: string, key: string): Promise<Details> {
  try {
    return await fetchJson<Details>(`${API}/places/${placeId}?languageCode=en`, {
      headers: headers(key, ["id", ...ATMOSPHERE_FIELDS]),
      timeoutMs: 15_000,
    });
  } catch {
    return {};
  }
}

function services(place: Details): BusinessServices | undefined {
  const out: BusinessServices = {};
  for (const field of SERVICE_FIELDS) if (place[field] !== undefined) out[field] = place[field];
  return Object.keys(out).length ? out : undefined;
}

const toHours = (t: Weekday) => t.hour + t.minute / 60;

// The latest closing time on a weekday (Monday to Friday), in hours: 21.5 = 9:30 pm, 25 = 1 am the
// next day. A place that never closes, which Google sends as a period with no close, counts as 24.
export function closesAt(periods: { open: Weekday; close?: Weekday }[] | undefined): number | undefined {
  if (!periods?.length) return undefined;
  if (periods.some((p) => !p.close)) return 24;
  const weekday = periods.filter((p) => p.open.day >= 1 && p.open.day <= 5);
  if (weekday.length === 0) return undefined;
  const closes = weekday.map((p) => toHours(p.close!) + (p.close!.day !== p.open.day ? 24 : 0));
  return Math.round(Math.max(...closes) * 100) / 100;
}

export type Parsed = { business: Business; ratingCount: number; reviews: Review[] };

export function parsePlace(place: Place): Parsed | null {
  const name = place.displayName?.text;
  const category = categorizeGoogle(place.types ?? [], place.primaryType);
  if (!name || !place.location || !category) return null;
  const hours = place.regularOpeningHours;
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
      reviewCount: place.userRatingCount,
      priceLevel: place.priceLevel ? PRICE_LEVEL[place.priceLevel] : undefined,
      hours: hours?.weekdayDescriptions,
      closesAt: closesAt(hours?.periods),
      services: services(place),
    },
    ratingCount: place.userRatingCount ?? 0,
    reviews: place.reviews ?? [],
  };
}

function formatTime(hours: number): string {
  const h = Math.floor(hours) % 24;
  const m = Math.round((hours - Math.floor(hours)) * 60);
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${suffix}`;
}

// note adds a sentence, such as how far the place is from the pin.
export function placeDoc({ business: b, ratingCount }: Parsed, note?: string): SourceDoc {
  const parts = [`${b.name} is a ${CATEGORY_LABELS[b.category].toLowerCase()} business on Google Maps.`];
  if (b.rating !== undefined) parts.push(`Rated ${b.rating} out of 5 from ${ratingCount.toLocaleString("en-US")} ratings.`);
  if (b.status) parts.push(`Status: ${STATUS_TEXT[b.status]}.`);
  if (b.priceLevel !== undefined) parts.push(`Price level: ${PRICE_TEXT[b.priceLevel]}.`);
  if (b.closesAt !== undefined) {
    parts.push(b.closesAt >= 24 && b.hours?.some((h) => /open 24 hours/i.test(h))
      ? "Open 24 hours."
      : `Latest weekday closing time: ${formatTime(b.closesAt)}.`);
  }
  if (b.services) {
    const offered = Object.entries(b.services).filter(([, v]) => v).map(([k]) => SERVICE_TEXT[k as keyof BusinessServices]);
    const not = Object.entries(b.services).filter(([, v]) => v === false).map(([k]) => SERVICE_TEXT[k as keyof BusinessServices]);
    if (offered.length) parts.push(`Offers ${offered.join(", ")}.`);
    if (not.length) parts.push(`No ${not.join(", ")}.`);
  }
  if (b.hours?.length) parts.push(`Hours: ${b.hours.join("; ")}.`);
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
      mostRated.map(async (p) => {
        const details = await fetchDetails(placeIdOf(p.business), key);
        p.business.services = services(details);
        return reviewDocs(p.business, details.reviews ?? []);
      }),
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

// The fields a merged business takes from Places.
const PLACES_ONLY = ["rating", "status", "reviewCount", "priceLevel", "hours", "closesAt", "services"] as const;

// The existing business (OSM or Places) that a Places business duplicates: the same Places id, or the
// nearest OSM business with a matching name within 50 m that hasn't been merged with Places yet.
export function findDuplicate(existing: Business[], p: Business): Business | null {
  const same = existing.find((b) => b.id === p.id || b.docIds?.includes(p.id));
  if (same) return same;
  let best: Business | null = null;
  let bestDistance = MERGE_DISTANCE_M;
  for (const o of existing) {
    if (!o.id.startsWith("osm:") || o.docIds?.some((id) => id.startsWith("places:"))) continue;
    const d = distanceM(o, p);
    if (d <= bestDistance && namesMatch(o.name, p.name)) {
      best = o;
      bestDistance = d;
    }
  }
  return best;
}

// Fold each Places business into the OSM business it duplicates, so the map doesn't show two dots for
// one business. The merged business keeps its OSM id (category counts come from OSM) and takes the
// Places fields. Places businesses with no match are added as they are.
export function mergeBusinesses(osm: Business[], places: Business[]): Business[] {
  const merged = osm.map((b) => ({ ...b }));
  for (const p of places) {
    const best = findDuplicate(merged, p);
    if (!best) {
      merged.push({ ...p });
      continue;
    }
    if (best.id === p.id) continue;
    for (const field of PLACES_ONLY) if (p[field] !== undefined) Object.assign(best, { [field]: p[field] });
    best.docIds = [best.id, p.id];
  }
  return merged;
}
