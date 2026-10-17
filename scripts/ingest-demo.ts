// Runs collectArea live on the demo areas and saves each as data/demo/<slug>.json, plus the 2 km
// competitors for every category as data/demo/<slug>-competitors.json. A pin within 300 m of a demo
// center then loads the saved files instead of calling the sources.
//
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts                    both areas, everything
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts santa-monica       one area
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts --area-only        skip the competitors
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts --competitors-only only the competitors (20 Places calls per area)
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts --allow-errors     save the area even if a source failed
//
// Google limits how long Places content can be kept, so refresh these rather than keeping them long term.

import { mkdir, writeFile } from "node:fs/promises";
import { CATEGORY_IDS } from "../src/lib/ingest/categories";
import {
  DEMO_AREAS,
  DEMO_DIR,
  collectLive,
  competitorsFilePath,
  demoFilePath,
  fetchCompetitors,
  type SavedCompetitors,
} from "../src/lib/ingest/index";
import { errorMessage } from "../src/lib/ingest/http";
import type { AreaData } from "../src/lib/types";
import type { DemoArea } from "../src/lib/ingest/demo-areas";

// This script exists to make the billed Places calls, so it turns them on for itself.
process.env.PLACES_LIVE = "1";

// Parallel competitor searches, one billed call each.
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

// Categories that fail are left out, and collectCompetitors fetches them live when asked.
async function saveCompetitors(area: DemoArea): Promise<boolean> {
  const saved: SavedCompetitors = {};
  const failed: string[] = [];
  const queue = [...CATEGORY_IDS];
  const worker = async () => {
    for (let category = queue.shift(); category; category = queue.shift()) {
      try {
        const { docs, data } = await fetchCompetitors(category, area.center);
        saved[category] = { ...data, docs };
      } catch (err) {
        failed.push(`${category}: ${errorMessage(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Keep the category order stable, so a refresh produces a readable diff.
  const ordered = Object.fromEntries(CATEGORY_IDS.filter((c) => saved[c]).map((c) => [c, saved[c]]));
  await writeFile(competitorsFilePath(area), `${JSON.stringify(ordered, null, 2)}\n`);
  for (const c of CATEGORY_IDS) {
    const r = saved[c];
    if (!r) continue;
    const reviews = r.docs.filter((d) => d.source === "review").length;
    const rated = r.businesses.filter((b) => b.rating !== undefined);
    const avg = rated.length ? (rated.reduce((s, b) => s + b.rating!, 0) / rated.length).toFixed(1) : "-";
    console.log(`  ${c.padEnd(15)} ${String(r.businesses.length).padStart(2)} competitors, avg ${avg}, ${reviews} reviews`);
  }
  if (failed.length) console.error(`${area.slug}: competitors failed for ${failed.join("; ")}`);
  console.log(`${area.slug}: saved competitors for ${Object.keys(ordered).length} of ${CATEGORY_IDS.length} categories`);
  return failed.length === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const allowErrors = args.includes("--allow-errors");
  const areaOnly = args.includes("--area-only");
  const competitorsOnly = args.includes("--competitors-only");
  const slugs = args.filter((a) => !a.startsWith("--"));
  const areas = slugs.length ? DEMO_AREAS.filter((a) => slugs.includes(a.slug)) : DEMO_AREAS;
  if (areas.length === 0) throw new Error(`Unknown area. Expected one of: ${DEMO_AREAS.map((a) => a.slug).join(", ")}`);

  await mkdir(DEMO_DIR, { recursive: true });
  let ok = true;
  for (const area of areas) {
    if (!competitorsOnly) ok = (await saveArea(area, allowErrors)) && ok;
    if (!areaOnly) ok = (await saveCompetitors(area)) && ok;
  }
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
