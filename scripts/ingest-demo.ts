// Runs collectArea live on the demo areas and saves each as data/demo/<slug>.json, plus reviews for
// every category as data/demo/<slug>-category-reviews.json. A pin within 300 m of a demo center then
// loads the saved files instead of calling the sources.
//
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts                    both areas, everything
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts santa-monica       one area
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts --area-only        skip category reviews
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts --categories-only  only category reviews (about 130 Places calls per area)
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts --allow-errors     save the area even if a source failed
//
// Google limits how long Places content can be kept, so refresh these rather than keeping them long term.

import { mkdir, writeFile } from "node:fs/promises";
import { CATEGORY_IDS } from "../src/lib/ingest/categories";
import {
  DEMO_AREAS,
  DEMO_DIR,
  categoryReviewsFilePath,
  collectLive,
  demoFilePath,
  fetchCategoryReviews,
  type SavedCategoryReviews,
} from "../src/lib/ingest/index";
import { errorMessage } from "../src/lib/ingest/http";
import type { AreaData, CategoryId } from "../src/lib/types";
import type { DemoArea } from "../src/lib/ingest/demo-areas";

// Parallel category fetches. Each is up to 2 searches and 5 details calls.
const CONCURRENCY = 4;

async function saveArea(area: DemoArea, allowErrors: boolean): Promise<boolean> {
  const started = Date.now();
  const data: AreaData = await collectLive(area.center);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  // A file saved with a source missing would quietly weaken the stage demo, so keep the old one.
  if (data.errors.length && !allowErrors) {
    const errors = data.errors.map((e) => `${e.source}: ${e.message}`).join("; ");
    console.error(`${area.slug}: not saved (${errors}). Rerun, or pass --allow-errors.`);
    return false;
  }
  await writeFile(demoFilePath(area), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${area.slug}: saved ${data.businesses.length} businesses, ${data.docs.length} docs, ${seconds}s`);
  return true;
}

// Categories that fail are left out, and getCategoryReviews fetches them live when asked.
async function saveCategoryReviews(area: DemoArea): Promise<boolean> {
  const saved: SavedCategoryReviews = {};
  const failed: string[] = [];
  const queue = [...CATEGORY_IDS];
  const worker = async () => {
    for (let category = queue.shift(); category; category = queue.shift()) {
      try {
        saved[category as CategoryId] = await fetchCategoryReviews(area.center, category);
      } catch (err) {
        failed.push(`${category}: ${errorMessage(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Keep the category order stable, so a refresh produces a readable diff.
  const ordered = Object.fromEntries(CATEGORY_IDS.filter((c) => saved[c]).map((c) => [c, saved[c]]));
  await writeFile(categoryReviewsFilePath(area), `${JSON.stringify(ordered, null, 2)}\n`);
  for (const c of CATEGORY_IDS) {
    const r = saved[c];
    if (!r) continue;
    const inside = r.competitors.filter((x) => x.inArea).length;
    const reviews = r.docs.filter((d) => d.source === "review").length;
    const wide = r.searchedRadiusM > 800 ? `, ${r.competitors.length - inside} more within ${r.searchedRadiusM} m` : "";
    console.log(`  ${c.padEnd(15)} ${String(inside).padStart(2)} inside${wide}, ${reviews} reviews`);
  }
  if (failed.length) console.error(`${area.slug}: category reviews failed for ${failed.join("; ")}`);
  console.log(`${area.slug}: saved category reviews for ${Object.keys(ordered).length} of ${CATEGORY_IDS.length} categories`);
  return failed.length === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const allowErrors = args.includes("--allow-errors");
  const areaOnly = args.includes("--area-only");
  const categoriesOnly = args.includes("--categories-only");
  const slugs = args.filter((a) => !a.startsWith("--"));
  const areas = slugs.length ? DEMO_AREAS.filter((a) => slugs.includes(a.slug)) : DEMO_AREAS;
  if (areas.length === 0) throw new Error(`Unknown area. Expected one of: ${DEMO_AREAS.map((a) => a.slug).join(", ")}`);

  await mkdir(DEMO_DIR, { recursive: true });
  let ok = true;
  for (const area of areas) {
    if (!categoriesOnly) ok = (await saveArea(area, allowErrors)) && ok;
    if (!areaOnly) ok = (await saveCategoryReviews(area)) && ok;
  }
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
