// Runs collectArea for a demo area or a lat,lng and prints a summary to check by hand.
//
//   npx tsx --env-file=.env.local scripts/check-area.ts santa-monica
//   npx tsx --env-file=.env.local scripts/check-area.ts 40.7075,-74.0113 --live
//   npx tsx --env-file=.env.local scripts/check-area.ts all --live
//
// Live runs skip Google Places unless PLACES_LIVE=1 (billed, about $0.24 per area):
//   PLACES_LIVE=1 npx tsx --env-file=.env.local scripts/check-area.ts santa-monica --live

import { CATEGORIES } from "../src/lib/ingest/categories";
import { getDemoArea } from "../src/lib/ingest/demo-areas";
import { DEMO_AREAS, collectArea } from "../src/lib/ingest/index";
import type { LatLng } from "../src/lib/types";

function parseTarget(arg: string): { label: string; point: LatLng }[] {
  if (arg === "all") return DEMO_AREAS.map((a) => ({ label: a.name, point: a.center }));
  const area = getDemoArea(arg);
  if (area) return [{ label: area.name, point: area.center }];
  const [lat, lng] = arg.split(",").map(Number);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return [{ label: arg, point: { lat, lng } }];
  const slugs = DEMO_AREAS.map((a) => a.slug).join(", ");
  throw new Error(`Expected "all", a demo slug (${slugs}) or "lat,lng", got "${arg}"`);
}

async function check(label: string, point: LatLng, live: boolean) {
  const started = Date.now();
  const area = await collectArea(point.lat, point.lng, { live });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n=== ${label} (${area.center.lat}, ${area.center.lng}), ${area.radiusM} m ===`);
  console.log(`${area.from}${area.demoArea ? `, demo area ${area.demoArea}` : ""}, ${seconds}s`);

  console.log(`\nBusinesses: ${area.businesses.length}`);
  for (const c of CATEGORIES) {
    const n = area.categoryCounts[c.id];
    const examples = area.businesses.filter((b) => b.category === c.id).slice(0, 3).map((b) => b.name);
    console.log(`  ${c.label.padEnd(16)} ${String(n).padStart(4)}  ${examples.join(", ")}`);
  }

  const rated = area.businesses.filter((b) => b.rating !== undefined);
  const merged = rated.filter((b) => b.docIds?.length);
  console.log(`\nRated (Places): ${rated.length}, merged into an OSM business: ${merged.length}`);
  for (const b of merged) console.log(`  ${b.name} ${b.rating}  ${b.docIds!.join(" + ")}`);
  for (const b of rated.filter((b) => !b.docIds)) console.log(`  ${b.name} ${b.rating}  new from Places (${b.category})`);

  const d = area.demographics;
  console.log("\nDemographics:");
  if (!d) console.log("  none");
  else {
    console.log(`  tracts ${d.tractFips.length}: ${d.tractFips.join(" ")}`);
    console.log(`  population ${d.population.toLocaleString("en-US")}`);
    console.log(`  median income ~$${d.medianIncome?.toLocaleString("en-US")}, median age ~${d.medianAge}, median rent ~$${d.medianRent?.toLocaleString("en-US")}`);
    console.log(`  renters ${d.pctRenters}%, households with kids ${d.pctWithKids}%, no vehicle ${d.pctNoVehicle}%`);
  }

  const bySource = new Map<string, number>();
  for (const doc of area.docs) bySource.set(doc.source, (bySource.get(doc.source) ?? 0) + 1);
  console.log(`\nDocs: ${[...bySource].map(([s, n]) => `${s} ${n}`).join(", ") || "none"}`);
  for (const source of bySource.keys()) {
    const sample = area.docs.find((doc) => doc.source === source)!;
    console.log(`  e.g. ${sample.id}: ${sample.text.slice(0, 160)}`);
  }

  console.log(`\nErrors: ${area.errors.length ? area.errors.map((e) => `${e.source}: ${e.message}`).join("; ") : "none"}`);
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const target = args.find((a) => !a.startsWith("--")) ?? "all";
  for (const { label, point } of parseTarget(target)) await check(label, point, live);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
