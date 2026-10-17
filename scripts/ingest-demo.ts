// Runs collectArea live on the demo areas and saves each as data/demo/<slug>.json.
// A pin within 300 m of a demo center then loads the saved file instead of calling the sources.
//
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts                  both areas
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts santa-monica     one area
//   npx tsx --env-file=.env.local scripts/ingest-demo.ts --allow-errors   save even if a source failed
//
// Google limits how long Places content can be kept, so refresh these rather than keeping them long term.

import { mkdir, writeFile } from "node:fs/promises";
import { DEMO_AREAS, DEMO_DIR, collectLive, demoFilePath } from "../src/lib/ingest/index";
import type { AreaData } from "../src/lib/types";

async function main() {
  const args = process.argv.slice(2);
  const allowErrors = args.includes("--allow-errors");
  const slugs = args.filter((a) => !a.startsWith("--"));
  const areas = slugs.length ? DEMO_AREAS.filter((a) => slugs.includes(a.slug)) : DEMO_AREAS;
  if (areas.length === 0) throw new Error(`Unknown area. Expected one of: ${DEMO_AREAS.map((a) => a.slug).join(", ")}`);

  await mkdir(DEMO_DIR, { recursive: true });
  let failed = false;

  for (const area of areas) {
    const started = Date.now();
    const data: AreaData = await collectLive(area.center);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const summary = `${data.businesses.length} businesses, ${data.docs.length} docs, ${seconds}s`;

    // A file saved with a source missing would quietly weaken the stage demo, so keep the old one.
    if (data.errors.length && !allowErrors) {
      failed = true;
      const errors = data.errors.map((e) => `${e.source}: ${e.message}`).join("; ");
      console.error(`${area.slug}: not saved (${errors}). Rerun, or pass --allow-errors.`);
      continue;
    }

    await writeFile(demoFilePath(area), `${JSON.stringify(data, null, 2)}\n`);
    console.log(`${area.slug}: saved ${summary}`);
  }

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
