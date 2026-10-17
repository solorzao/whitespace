// Runs analyzeArea, Claude calls included, on the demo areas and saves each full /api/analyze response
// as data/demo/<slug>-analysis.json. A demo pin then returns the saved file instantly, with no Claude,
// Places or Overpass call (src/lib/analysis/saved.ts).
//
//   npx tsx --env-file=.env.local scripts/save-demo-analysis.ts                    both areas
//   npx tsx --env-file=.env.local scripts/save-demo-analysis.ts santa-monica       one area
//   npx tsx --env-file=.env.local scripts/save-demo-analysis.ts --live             fresh source data too (billed Places calls)
//   npx tsx --env-file=.env.local scripts/save-demo-analysis.ts --allow-errors     save even if a step failed
//
// Without --live, the analysis reads the saved area and competitor files (scripts/ingest-demo.ts), so
// the only live calls are Claude's. Rerun it after refreshing those files or changing the analysis.

import { mkdir, writeFile } from "node:fs/promises";
import { analyzeArea, CONCEPT_COUNT, type AnalysisResult } from "../src/lib/analysis";
import { analysisFilePath } from "../src/lib/analysis/saved";
import { DEMO_AREAS, DEMO_DIR } from "../src/lib/ingest";
import type { DemoArea } from "../src/lib/ingest/demo-areas";

// What would make the saved demo worse than a live run, so it isn't saved.
function problems(r: AnalysisResult): string[] {
  const found = r.errors.map((e) => `${e.source}${e.category ? ` (${e.category})` : ""}: ${e.message}`);
  if (r.concepts.length !== CONCEPT_COUNT) found.push(`${r.concepts.length} concepts, expected ${CONCEPT_COUNT}`);
  const ids = new Set(r.docs.map((d) => d.id));
  const missing = r.concepts.flatMap((c) => c.evidence).filter((id) => !ids.has(id));
  if (missing.length) found.push(`concept evidence not in docs: ${missing.join(", ")}`);
  return found;
}

async function saveArea(area: DemoArea, live: boolean, allowErrors: boolean): Promise<boolean> {
  const started = Date.now();
  const r = await analyzeArea(area.center.lat, area.center.lng, { live });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n=== ${area.name} (sources ${r.from}, ${seconds} s) ===`);
  for (const c of r.concepts) console.log(`  ${c.title} [${c.category}, ${c.gapType}]`);
  console.log(`  ${r.profiles.length} success profiles, ${r.summaries.length} popup summaries, ${r.docs.length} docs`);
  const found = problems(r);
  if (found.length) console.log(`  Problems:\n${found.map((p) => `    ${p}`).join("\n")}`);

  // A file saved with a missing step would quietly weaken the stage demo, so keep the old one.
  if (found.length && !allowErrors) {
    console.error(`  ${area.slug}: not saved. Rerun, or pass --allow-errors.`);
    return false;
  }
  const json = `${JSON.stringify(r, null, 2)}\n`;
  await writeFile(analysisFilePath(area), json);
  console.log(`  Saved ${analysisFilePath(area)} (${Math.round(json.length / 1024)} KB)`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const allowErrors = args.includes("--allow-errors");
  const slugs = args.filter((a) => !a.startsWith("--"));
  const areas = slugs.length ? DEMO_AREAS.filter((a) => slugs.includes(a.slug)) : DEMO_AREAS;
  if (areas.length === 0) throw new Error(`Unknown area. Expected one of: ${DEMO_AREAS.map((a) => a.slug).join(", ")}`);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (add it to .env.local).");
  // A fresh run needs the billed Places calls, which are off unless PLACES_LIVE=1.
  if (live) process.env.PLACES_LIVE = "1";

  await mkdir(DEMO_DIR, { recursive: true });
  let ok = true;
  // One area at a time, so the Claude calls of both don't compete for the rate limit.
  for (const area of areas) ok = (await saveArea(area, live, allowErrors)) && ok;
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
