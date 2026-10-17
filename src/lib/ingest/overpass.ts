// OpenStreetMap businesses and category counts, from the Overpass API.

import type { Business, CategoryId, LatLng, SourceDoc } from "../types";
import { CATEGORY_LABELS, OSM_KEYS, OSM_TAGS, categorizeOsm, emptyCounts } from "./categories";
import { isInCircle } from "./geo";
import { fetchJson } from "./http";
import { USER_AGENT, settle, type AdapterResult } from "./result";

// Tried in order, one attempt each. The main server can queue requests for 30+ seconds
// under load, so it gets a long timeout; the mirrors are often down, so they get short ones.
const ENDPOINTS = [
  { url: "https://overpass-api.de/api/interpreter", timeoutMs: 50_000 },
  { url: "https://overpass.kumi.systems/api/interpreter", timeoutMs: 20_000 },
  { url: "https://overpass.private.coffee/api/interpreter", timeoutMs: 20_000 },
];

const QUERY_TIMEOUT_S = 25;

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type OverpassData = {
  businesses: Business[];
  categoryCounts: Record<CategoryId, number>;
};

export function buildQuery(center: LatLng, radiusM: number): string {
  const around = `around:${radiusM},${center.lat},${center.lng}`;
  const values = (key: (typeof OSM_KEYS)[number]) => {
    const vals = Object.keys(OSM_TAGS[key]);
    // sports_centre only counts with a fitness sport, which categorizeOsm checks.
    if (key === "leisure") vals.push("sports_centre");
    return vals.join("|");
  };
  const lines = OSM_KEYS.map((key) => `  nwr(${around})[name]["${key}"~"^(${values(key)})$"];`);
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n(\n${lines.join("\n")}\n);\nout center tags;`;
}

async function runQuery(query: string): Promise<OsmElement[]> {
  let lastError: unknown;
  for (const { url, timeoutMs } of ENDPOINTS) {
    try {
      const res = await fetchJson<{ elements: OsmElement[] }>(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: new URLSearchParams({ data: query }),
        timeoutMs,
        retries: 0,
      });
      return res.elements;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function describe(tags: Record<string, string>, category: CategoryId): string {
  const kind = OSM_KEYS.filter((k) => tags[k]).map((k) => `${k}=${tags[k]}`).join(", ");
  const parts = [`${tags.name} is a ${CATEGORY_LABELS[category].toLowerCase()} business (${kind}).`];
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  if (street) parts.push(`Address: ${street}.`);
  if (tags.cuisine) parts.push(`Cuisine: ${tags.cuisine.replaceAll(";", ", ")}.`);
  if (tags.brand) parts.push(`Brand: ${tags.brand}.`);
  if (tags.opening_hours) parts.push(`Opening hours: ${tags.opening_hours}.`);
  return parts.join(" ");
}

export function parseElements(elements: OsmElement[], center: LatLng, radiusM: number) {
  const businesses: Business[] = [];
  const docs: SourceDoc[] = [];
  const categoryCounts = emptyCounts();
  const seen = new Set<string>();

  for (const el of elements) {
    const tags = el.tags;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!tags?.name || lat === undefined || lng === undefined) continue;
    // around matches a way if any part of it is in range; count it only if its center is.
    if (!isInCircle(center, { lat, lng }, radiusM)) continue;
    const category = categorizeOsm(tags);
    if (!category) continue;

    const id = `osm:${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const url = `https://www.openstreetmap.org/${el.type}/${el.id}`;
    businesses.push({ id, name: tags.name, category, lat, lng, url });
    docs.push({ id, source: "osm", url, title: tags.name, text: describe(tags, category), lat, lng, category });
    categoryCounts[category]++;
  }

  return { businesses, docs, categoryCounts };
}

export function fetchOverpass(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<AdapterResult<OverpassData>> {
  return settle(async () => {
    const center = { lat, lng };
    const elements = await runQuery(buildQuery(center, radiusM));
    const { businesses, docs, categoryCounts } = parseElements(elements, center, radiusM);
    return { docs, data: { businesses, categoryCounts } };
  });
}
