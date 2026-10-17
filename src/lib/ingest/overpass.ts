// OpenStreetMap businesses and category counts, from the Overpass API.

import type { Business, CategoryId, LatLng, SourceDoc } from "../types";
import { CATEGORY_LABELS, OSM_KEYS, OSM_TAGS, categorizeOsm, emptyCounts } from "./categories";
import { isInCircle } from "./geo";
import { HttpError, fetchJson } from "./http";
import { hedgedRace } from "./race";
import { USER_AGENT, settle, type AdapterResult } from "./result";

// The main server is asked first. It's usually fastest, but under load it can queue a request for
// 30+ seconds or fail outright, and the mirrors go up and down too. So if it hasn't answered in 3 s
// (or fails sooner), both mirrors are asked as well, and the first good answer wins. Waiting 3 s
// before asking the mirrors keeps the load on these free public servers low.
const MAIN = "https://overpass-api.de/api/interpreter";
const MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const HEDGE_AFTER_MS = 3_000;
// After this, give up: a quick "try again" beats a pin that hangs for a minute.
export const OVERPASS_TOTAL_MS = 20_000;

// The server-side limit on the query's run time, in seconds.
const QUERY_TIMEOUT_S = 20;

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

type OverpassResponse = { elements?: OsmElement[]; remark?: string };

// Waits, but stops early (by rejecting) when the race is over.
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    });
  });
}

// One server, asked again after 1, 2, then 4 s while it returns server errors: the public servers
// flap between 5xx and working, often within seconds. The race's 20 s cap ends the retries.
async function askServer(url: string, query: string, signal: AbortSignal): Promise<OsmElement[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await askServerOnce(url, query, signal);
    } catch (err) {
      const retryable = !(err instanceof HttpError) || err.status === 429 || err.status >= 500;
      if (signal.aborted || !retryable) throw err;
      await pause(Math.min(1000 * 2 ** attempt, 4000), signal);
    }
  }
}

async function askServerOnce(url: string, query: string, signal: AbortSignal): Promise<OsmElement[]> {
  const res = await fetchJson<OverpassResponse>(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({ data: query }),
    signal,
    timeoutMs: OVERPASS_TOTAL_MS,
    retries: 0,
  });
  // A query that hits the server's limits still returns 200, with partial results and a remark.
  if (res.remark && /error|timed out/i.test(res.remark)) throw new Error(`incomplete result: ${res.remark}`);
  if (!res.elements) throw new Error("no elements in the response");
  return res.elements;
}

async function runQuery(query: string): Promise<OsmElement[]> {
  const started = Date.now();
  const { value, name } = await hedgedRace(
    [MAIN, ...MIRRORS].map((url) => ({ name: new URL(url).host, run: (signal: AbortSignal) => askServer(url, query, signal) })),
    {
      hedgeAfterMs: HEDGE_AFTER_MS,
      totalMs: OVERPASS_TOTAL_MS,
      timeoutMessage: `no OpenStreetMap server answered within ${OVERPASS_TOTAL_MS / 1000} s`,
    },
  );
  console.info(`overpass: ${name} answered in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return value;
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
