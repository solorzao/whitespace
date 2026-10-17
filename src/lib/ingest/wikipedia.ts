// Geotagged Wikipedia articles near the pin, as context for /api/ask only.

import type { SourceDoc } from "../types";
import { fetchJson } from "./http";
import { USER_AGENT, settle, type AdapterResult } from "./result";

const API = "https://en.wikipedia.org/w/api.php";
const MAX_ARTICLES = 30;
const EXTRACT_BATCH = 20; // the most intro extracts the API returns per request
const MAX_TEXT = 1500;

type GeoResult = { pageid: number; title: string; lat: number; lon: number; dist: number };
type Page = { pageid: number; title: string; extract?: string; fullurl?: string };

export type WikipediaData = Record<string, never>;

function query<T>(params: Record<string, string>): Promise<T> {
  const search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params });
  return fetchJson<T>(`${API}?${search}`, { headers: { "User-Agent": USER_AGENT }, timeoutMs: 10_000 });
}

async function geosearch(lat: number, lng: number, radiusM: number): Promise<GeoResult[]> {
  const res = await query<{ query?: { geosearch: GeoResult[] } }>({
    list: "geosearch",
    gscoord: `${lat}|${lng}`,
    gsradius: String(Math.min(radiusM, 10_000)),
    gslimit: String(MAX_ARTICLES),
  });
  return res.query?.geosearch ?? [];
}

async function fetchExtracts(pageIds: number[]): Promise<Map<number, Page>> {
  const batches: number[][] = [];
  for (let i = 0; i < pageIds.length; i += EXTRACT_BATCH) batches.push(pageIds.slice(i, i + EXTRACT_BATCH));
  const results = await Promise.all(
    batches.map((ids) =>
      query<{ query?: { pages: Page[] } }>({
        prop: "extracts|info",
        exintro: "1",
        explaintext: "1",
        exlimit: String(EXTRACT_BATCH),
        inprop: "url",
        pageids: ids.join("|"),
      }),
    ),
  );
  return new Map(results.flatMap((r) => r.query?.pages ?? []).map((p) => [p.pageid, p]));
}

function truncate(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  const cut = text.slice(0, MAX_TEXT);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export function fetchWikipedia(lat: number, lng: number, radiusM: number): Promise<AdapterResult<WikipediaData>> {
  return settle<WikipediaData>(async () => {
    const hits = await geosearch(lat, lng, radiusM);
    const pages = await fetchExtracts(hits.map((h) => h.pageid));
    const docs: SourceDoc[] = [];
    for (const hit of hits) {
      const extract = pages.get(hit.pageid)?.extract?.trim();
      if (!extract) continue;
      docs.push({
        id: `wikipedia:${hit.pageid}`,
        source: "wikipedia",
        url: pages.get(hit.pageid)?.fullurl ?? `https://en.wikipedia.org/?curid=${hit.pageid}`,
        title: hit.title,
        text: `${truncate(extract)} (${Math.round(hit.dist)} m from the pin.)`,
        lat: hit.lat,
        lng: hit.lon,
      });
    }
    return { docs, data: {} };
  });
}
