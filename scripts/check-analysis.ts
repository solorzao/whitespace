// Runs analyzeArea, the whole /api/analyze pipeline, on the demo areas and prints what the cards would show.
//
//   npx tsx --env-file=.env.local scripts/check-analysis.ts                both demo areas, with Claude (needs ANTHROPIC_API_KEY)
//   npx tsx --env-file=.env.local scripts/check-analysis.ts santa-monica   one demo area
//   npx tsx scripts/check-analysis.ts --no-claude                          no Claude calls: no concepts, and profiles from attributes only
//
// Add --live to skip the saved data (needs the Places and Census keys, and PLACES_LIVE=1 for Places).

import { analyzeArea, CONCEPT_COUNT, type AnalysisResult } from "../src/lib/analysis";
import { describeFinding } from "../src/lib/analysis/profile";
import { DEMO_AREAS } from "../src/lib/ingest";
import { CATEGORY_LABELS } from "../src/lib/ingest/categories";

const args = process.argv.slice(2);
const noClaude = args.includes("--no-claude");
const live = args.includes("--live");
const slug = args.find((a) => !a.startsWith("--"));

let failures = 0;
function check(condition: boolean, message: string) {
  console.log(`  ${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failures += 1;
}

function checkResult(r: AnalysisResult) {
  const ids = r.docs.map((d) => d.id);
  const known = new Set(ids);
  const chosen = new Set(r.gaps.filter((g) => g.score > 0).slice(0, CONCEPT_COUNT).map((g) => g.category));
  check(known.size === ids.length, "doc ids are unique");
  check(r.businesses.every((b) => known.has(b.id)), "every business is in docs");
  check(r.competitors.every((c) => known.has(c.id)), "every competitor is in docs");
  const onMap = new Set(r.businesses.flatMap((b) => [b.id, ...(b.docIds ?? [])]));
  check(r.competitors.every((c) => !onMap.has(c.id)), "competitors leave out businesses already on the map");
  check(r.profiles.every((p) => chosen.has(p.category)), "profiles are for the concept categories");
  check(
    r.profiles.every((p) => [...p.businessIds, ...p.findings.flatMap((f) => f.evidence)].every((id) => known.has(id))),
    "every profile id is in docs",
  );
  check(
    r.concepts.every((c) => chosen.has(c.category) && c.evidence.every((id) => known.has(id))),
    "concepts use the concept categories and cite ids in docs",
  );
  // generateConcepts always writes 3; with fewer than 3 gaps, they may share a category.
  if (!noClaude) check(r.concepts.length === (chosen.size > 0 ? CONCEPT_COUNT : 0), `${r.concepts.length} concepts`);
}

function print(r: AnalysisResult, seconds: number) {
  const d = r.demographics;
  console.log(
    d
      ? `Demographics: ${d.population.toLocaleString("en-US")} residents in ${d.tractFips.length} tracts`
      : "Demographics: none (outside the US?)",
  );
  console.log(`Top gaps: ${r.gaps.slice(0, 5).map((g) => `${g.category} ${g.score}`).join(", ")}`);
  const chosen = r.gaps.filter((g) => g.score > 0).slice(0, CONCEPT_COUNT).map((g) => g.category);
  console.log(`Concept categories: ${chosen.join(", ") || "none"}`);
  console.log(
    `Competitors within 2 km not on the map: ${chosen.map((c) => `${c} ${r.competitors.filter((b) => b.category === c).length}`).join(", ")}`,
  );

  for (const category of chosen) {
    const p = r.profiles.find((x) => x.category === category);
    if (!p) {
      console.log(`\n  ${CATEGORY_LABELS[category]}: no success profile`);
      continue;
    }
    console.log(`\n  ${CATEGORY_LABELS[category]}: ${p.businessIds.length} compared, ${p.reviewCount} reviews`);
    if (p.findings.length === 0) console.log("    (no findings)");
    p.findings.forEach((f, i) => console.log(`  ${i < 2 ? "*" : " "} ${describeFinding(f)}`));
  }

  for (const c of r.concepts) {
    console.log(`\n  ${c.title} [${c.category}]`);
    console.log(`    Rationale: ${c.rationale}`);
    console.log(`    Evidence:  ${c.evidence.join(", ")}`);
    console.log(`    Risk:      ${c.risk}`);
  }

  if (r.errors.length) {
    console.log(`\nErrors:\n${r.errors.map((e) => `  ${e.source}${e.category ? ` (${e.category})` : ""}: ${e.message}`).join("\n")}`);
  }
  const reviews = r.docs.filter((x) => x.source === "review").length;
  const kb = Math.round(JSON.stringify(r).length / 1024);
  console.log(`\nResponse: ${r.docs.length} docs (${reviews} reviews), ${kb} KB, ${seconds.toFixed(1)} s\n`);
}

async function main() {
  if (!noClaude && !process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY is not set (add it to .env.local), or pass --no-claude to skip the Claude calls.");
    process.exitCode = 1;
    return;
  }
  const areas = slug ? DEMO_AREAS.filter((a) => a.slug === slug) : DEMO_AREAS;
  if (areas.length === 0) throw new Error(`Unknown demo area "${slug}". Use one of: ${DEMO_AREAS.map((a) => a.slug).join(", ")}`);

  for (const area of areas) {
    const started = Date.now();
    const r = await analyzeArea(area.center.lat, area.center.lng, { live, claude: !noClaude });
    console.log(`\n=== ${area.name} (${r.from}${noClaude ? ", no Claude" : ""}) ===`);
    print(r, (Date.now() - started) / 1000);
    checkResult(r);
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
