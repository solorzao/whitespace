// collectArea(): the saved demo data for pins near a demo center, otherwise every adapter run live and merged.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterError, AreaData, Demographics, LatLng, SourceKind } from "../types";
import { emptyCounts } from "./categories";
import { fetchCensus } from "./census";
import { AREA_RADIUS_M, findDemoArea, type DemoArea } from "./demo-areas";
import { fetchOverpass } from "./overpass";
import { fetchPlaces, mergeBusinesses } from "./places";
import type { AdapterResult } from "./result";

export { AREA_RADIUS_M, DEMO_AREAS, findDemoArea } from "./demo-areas";

// Thrown when there's no business data at all. /api/analyze should answer 503.
export class AreaUnavailableError extends Error {
  constructor(detail: string) {
    super(`Business data unavailable, try again. (${detail})`);
    this.name = "AreaUnavailableError";
  }
}

export type CollectOptions = {
  live?: boolean; // skip the saved demo data
};

export type CollectResult = AreaData & {
  from: "saved" | "live";
  demoArea?: string; // slug, when the pin snapped to a demo center
};

// Each adapter's own fetches have timeouts; this is a backstop. Overpass alone can take
// 50 + 20 + 20 seconds when the main server is slow and the mirrors are down.
const ADAPTER_TIMEOUT_MS = 95_000;

export const DEMO_DIR = path.join(process.cwd(), "data", "demo");

export function demoFilePath(area: DemoArea): string {
  return path.join(DEMO_DIR, `${area.slug}.json`);
}

async function readSaved(area: DemoArea): Promise<AreaData | null> {
  try {
    return JSON.parse(await readFile(demoFilePath(area), "utf8")) as AreaData;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function withTimeout<T>(source: SourceKind, p: Promise<AdapterResult<T>>): Promise<AdapterResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AdapterResult<T>>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, error: `${source} timed out after ${ADAPTER_TIMEOUT_MS / 1000}s` }),
      ADAPTER_TIMEOUT_MS,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function collectLive(center: LatLng, radiusM = AREA_RADIUS_M): Promise<AreaData> {
  const { lat, lng } = center;
  const [osm, censusResult, places] = await Promise.all([
    withTimeout("osm", fetchOverpass(lat, lng, radiusM)),
    withTimeout("census", fetchCensus(lat, lng, radiusM)),
    withTimeout("places", fetchPlaces(lat, lng, radiusM)),
  ]);

  if (!osm.ok) throw new AreaUnavailableError(osm.error);

  const errors: AdapterError[] = [];
  const docs = [...osm.docs];
  let demographics: Demographics | null = null;
  if (censusResult.ok) {
    docs.push(...censusResult.docs);
    demographics = censusResult.data.demographics;
  } else {
    errors.push({ source: "census", message: censusResult.error });
  }
  let businesses = osm.data.businesses;
  if (places.ok) {
    docs.push(...places.docs);
    businesses = mergeBusinesses(businesses, places.data.businesses);
  } else {
    errors.push({ source: "places", message: places.error });
  }

  return {
    center,
    radiusM,
    businesses,
    demographics,
    categoryCounts: { ...emptyCounts(), ...osm.data.categoryCounts },
    docs,
    errors,
  };
}

export async function collectArea(lat: number, lng: number, options: CollectOptions = {}): Promise<CollectResult> {
  const demo = options.live ? null : findDemoArea({ lat, lng });
  if (demo) {
    const saved = await readSaved(demo);
    if (saved) return { ...saved, from: "saved", demoArea: demo.slug };
    // No saved file yet: run live at the demo center, so the result matches what gets saved.
    return { ...(await collectLive(demo.center)), from: "live", demoArea: demo.slug };
  }
  return { ...(await collectLive({ lat, lng })), from: "live" };
}
