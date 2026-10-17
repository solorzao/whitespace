// collectArea(): the saved demo data for pins near a demo center, otherwise every adapter run live and merged.

import type { AdapterError, AreaData, Demographics, LatLng, SourceKind } from "../types";
import { emptyCounts } from "./categories";
import { fetchCensus } from "./census";
import { AREA_RADIUS_M, WIKIPEDIA_RADIUS_M, findDemoArea } from "./demo-areas";
import { fetchOverpass } from "./overpass";
import { fetchPlaces, mergeBusinesses } from "./places";
import { fetchWikipedia } from "./wikipedia";
import type { AdapterResult } from "./result";
import { demoFilePath, readSaved } from "./saved";

export { AREA_RADIUS_M, DEMO_AREAS, findDemoArea } from "./demo-areas";
export { DEMO_DIR, categoryReviewsFilePath, demoFilePath } from "./saved";
export {
  CATEGORY_REVIEWS_TOOL,
  addCategoryReviews,
  collectCategoryReviews,
  fetchCategoryReviews,
  getCategoryReviews,
  runCategoryReviewsTool,
  summarize as summarizeCategoryReviews,
  type CategoryReviews,
  type Competitor,
  type SavedCategoryReviews,
} from "./category-reviews";

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
  const [osm, censusResult, places, wikipedia] = await Promise.all([
    withTimeout("osm", fetchOverpass(lat, lng, radiusM)),
    withTimeout("census", fetchCensus(lat, lng, radiusM)),
    withTimeout("places", fetchPlaces(lat, lng, radiusM)),
    // Wikipedia covers a wider area: landmarks a bit outside the circle still describe it.
    withTimeout("wikipedia", fetchWikipedia(lat, lng, Math.max(radiusM, WIKIPEDIA_RADIUS_M))),
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
  if (wikipedia.ok) docs.push(...wikipedia.docs);
  else errors.push({ source: "wikipedia", message: wikipedia.error });

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
    const saved = await readSaved<AreaData>(demoFilePath(demo));
    if (saved) return { ...saved, from: "saved", demoArea: demo.slug };
    // No saved file yet: run live at the demo center, so the result matches what gets saved.
    return { ...(await collectLive(demo.center)), from: "live", demoArea: demo.slug };
  }
  return { ...(await collectLive({ lat, lng })), from: "live" };
}
