// Pre-answers the search menu's suggestions (src/lib/suggestions), so clicking one opens a saved thread
// with no wait. For each place it runs the full analysis once, then answers each of the place's
// questions with the code /api/ask uses (answerQuestion), and saves both (src/lib/suggestions/saved.ts).
//
//   npx tsx --env-file=.env.local scripts/save-suggestions.ts                answer what isn't saved yet
//   npx tsx --env-file=.env.local scripts/save-suggestions.ts --live         also analyze new places (billed Places calls)
//   npx tsx --env-file=.env.local scripts/save-suggestions.ts --reanswer     answer every question again
//   npx tsx --env-file=.env.local scripts/save-suggestions.ts cherrywood     only suggestions whose id or place matches
//   npx tsx --env-file=.env.local scripts/save-suggestions.ts --allow-errors save an analysis even if a step failed
//
// The demo areas reuse their saved analysis (scripts/save-demo-analysis.ts), so they cost one Claude call
// per question. Any other place needs --live the first time: one circle search, 8 Place Details calls and
// up to 20 competitor searches, about $1 of Places calls at list price. Its analysis is then saved, and
// later runs reuse it.

import { mkdir, writeFile } from "node:fs/promises";
import { analyzeArea, CONCEPT_COUNT, type AnalysisResult } from "../src/lib/analysis";
import { answerQuestion } from "../src/lib/ask/answer";
import { AREA_RADIUS_M } from "../src/lib/ingest/demo-areas";
import { fetchOverpass } from "../src/lib/ingest/overpass";
import { readSaved } from "../src/lib/ingest/saved";
import { SUGGESTIONS, type SuggestionPlace } from "../src/lib/suggestions";
import {
  ANSWERS_FILE,
  CAVEAT,
  isDemoPlace,
  placeAnalysisPath,
  SUGGESTIONS_DIR,
  type SavedAnswers,
} from "../src/lib/suggestions/saved";

// What would make the saved thread worse than a live run, so it isn't saved (as in save-demo-analysis.ts).
function problems(r: AnalysisResult): string[] {
  const found = r.errors.map((e) => `${e.source}${e.category ? ` (${e.category})` : ""}: ${e.message}`);
  if (r.concepts.length !== CONCEPT_COUNT) found.push(`${r.concepts.length} concepts, expected ${CONCEPT_COUNT}`);
  const ids = new Set(r.docs.map((d) => d.id));
  const missing = r.concepts.flatMap((c) => c.evidence).filter((id) => !ids.has(id));
  if (missing.length) found.push(`concept evidence not in docs: ${missing.join(", ")}`);
  for (const c of r.concepts) {
    const caveat = CAVEAT.exec(`${c.title} ${c.rationale} ${c.risk}`);
    if (caveat) found.push(`the ${c.category} card says "${caveat[0]}"`);
  }
  // Follow-up questions send these docs to /api/ask, which refuses more than this (src/app/api/ask/route.ts).
  const chars = r.docs.reduce((sum, d) => sum + d.id.length + d.title.length + d.text.length, 0);
  if (r.docs.length > 1500 || chars > 600_000) found.push(`${r.docs.length} docs, ${chars} chars: over the /api/ask limits`);
  return found;
}

// OpenStreetMap's servers are often slow, and analyzeArea fails without them after the Places calls are
// made. A free check first keeps a timeout from wasting the billed calls.
async function overpassAnswers(place: SuggestionPlace): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetchOverpass(place.center.lat, place.center.lng, AREA_RADIUS_M);
    if (r.ok) return true;
    console.log(`  OpenStreetMap: ${r.error} (try ${attempt} of 3)`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return false;
}

async function placeAnalysis(place: SuggestionPlace, live: boolean, allowErrors: boolean): Promise<AnalysisResult | null> {
  const file = placeAnalysisPath(place);
  const saved = await readSaved<AnalysisResult>(file);
  if (saved) return saved;
  if (isDemoPlace(place)) {
    console.error(`  ${place.name}: ${file} is missing. Run scripts/save-demo-analysis.ts first.`);
    return null;
  }
  if (!live) {
    console.error(`  ${place.name}: not analyzed yet. Pass --live to run it (billed Places calls).`);
    return null;
  }

  if (!(await overpassAnswers(place))) {
    console.error(`  ${place.name}: OpenStreetMap didn't answer, so the billed run was skipped. Try again later.`);
    return null;
  }
  const started = Date.now();
  let r: AnalysisResult;
  try {
    r = await analyzeArea(place.center.lat, place.center.lng, { live: true });
  } catch (error) {
    console.error(`  ${place.name}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
  console.log(`  Analyzed ${place.name} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (const c of r.concepts) console.log(`    ${c.title} [${c.category}, ${c.gapType}]`);
  console.log(`    ${r.businesses.length} businesses, ${r.profiles.length} profiles, ${r.docs.length} docs`);
  const found = problems(r);
  if (found.length) console.log(`    Problems:\n${found.map((p) => `      ${p}`).join("\n")}`);
  if (found.length && !allowErrors) {
    console.error(`  ${place.name}: not saved. Rerun, or pass --allow-errors.`);
    return null;
  }
  // Compact, unlike the demo files: these are only read by code, and the repo carries one per place.
  const json = `${JSON.stringify(r)}\n`;
  await writeFile(file, json);
  console.log(`    Saved ${file} (${Math.round(json.length / 1024)} KB)`);
  return r;
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const reanswer = args.includes("--reanswer");
  const allowErrors = args.includes("--allow-errors");
  const filters = args.filter((a) => !a.startsWith("--"));
  const chosen = SUGGESTIONS.filter(
    (s) => filters.length === 0 || filters.some((f) => s.id.includes(f) || s.place.slug.includes(f)),
  );
  if (chosen.length === 0) throw new Error(`No suggestion matches ${filters.join(", ")}.`);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (add it to .env.local).");
  // A new place needs the billed Places calls, which are off unless PLACES_LIVE=1.
  if (live) process.env.PLACES_LIVE = "1";

  await mkdir(SUGGESTIONS_DIR, { recursive: true });
  const answers: SavedAnswers = (await readSaved<SavedAnswers>(ANSWERS_FILE)) ?? {};
  let ok = true;
  // One place at a time, so the Claude calls don't compete for the rate limit.
  const places = [...new Map(chosen.map((s) => [s.place.slug, s.place])).values()];
  for (const place of places) {
    console.log(`\n=== ${place.name} ===`);
    const analysis = await placeAnalysis(place, live, allowErrors);
    if (!analysis) {
      ok = false;
      continue;
    }
    for (const s of chosen.filter((s) => s.place.slug === place.slug)) {
      const current = answers[s.id];
      if (!reanswer && current?.question === s.question) {
        console.log(`\n  [${s.id}] saved already`);
        continue;
      }
      try {
        const response = await answerQuestion({ question: s.question, docs: analysis.docs });
        console.log(`\n  [${s.id}] ${s.question}\n  ${response.answer.replace(/\n/g, "\n  ")}`);
        console.log(`  ${response.citations.length} citations`);
        const caveat = CAVEAT.exec(response.answer);
        if (caveat || response.citations.length === 0) {
          ok = false;
          console.error(`  [${s.id}] not saved: ${caveat ? `the answer says "${caveat[0]}"` : "no citations"}. Reword the question.`);
          continue;
        }
        answers[s.id] = { question: s.question, response, createdAt: new Date().toISOString() };
        // Saved after every answer, so a failure later in the run keeps what's done.
        await writeFile(ANSWERS_FILE, `${JSON.stringify(answers, null, 2)}\n`);
      } catch (error) {
        ok = false;
        console.error(`  [${s.id}] failed: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
  // Answers to suggestions that no longer exist are dropped.
  const ids = new Set(SUGGESTIONS.map((s) => s.id));
  const stale = Object.keys(answers).filter((id) => !ids.has(id));
  if (stale.length) {
    for (const id of stale) delete answers[id];
    await writeFile(ANSWERS_FILE, `${JSON.stringify(answers, null, 2)}\n`);
    console.log(`\nDropped answers for removed suggestions: ${stale.join(", ")}`);
  }
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
