// The saved /api/analyze responses for the demo areas, data/demo/<slug>-analysis.json, written by
// scripts/save-demo-analysis.ts. A demo pin returns one of these, so the stage demo makes no Claude,
// Places or Overpass calls. Node only (reads files), so client code shouldn't import it.

import path from "node:path";
import { DEMO_DIR, findDemoArea } from "../ingest";
import type { DemoArea } from "../ingest/demo-areas";
import { readSaved } from "../ingest/saved";
import type { AnalysisResult } from "./index";

export function analysisFilePath(area: DemoArea): string {
  return path.join(DEMO_DIR, `${area.slug}-analysis.json`);
}

// The saved analysis for a pin within 300 m of a demo center, centered on the demo center as it was
// saved. null away from the demo areas, or when the file doesn't exist yet.
export async function savedAnalysis(lat: number, lng: number): Promise<AnalysisResult | null> {
  const demo = findDemoArea({ lat, lng });
  if (!demo) return null;
  const saved = await readSaved<AnalysisResult>(analysisFilePath(demo));
  return saved && { ...saved, from: "saved", demoArea: demo.slug };
}
