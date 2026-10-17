import type { NextRequest } from "next/server";
import { analyzeArea, savedAnalysis } from "@/lib/analysis";
import { AreaUnavailableError } from "@/lib/ingest";
// useMocks isn't a React hook; the alias keeps the rules-of-hooks lint from flagging it.
import { mockAnalysis, useMocks as mocksEnabled } from "@/lib/mock";
import { parsePoint } from "@/lib/point";

// The concepts call budgets 75 s, and the competitor search and tagging run alongside it. Demo pins
// return the saved analysis instantly; a live area adds the data sources' time.
export const maxDuration = 120;

// POST /api/analyze?live=1 skips the saved demo data and runs every source and Claude call.
export async function POST(request: NextRequest) {
  const point = parsePoint(await request.json().catch(() => null));
  if (!point) {
    return Response.json(
      { error: "Send JSON with numeric lat and lng." },
      { status: 400 },
    );
  }

  if (mocksEnabled())
    return Response.json({ ...mockAnalysis(point), mock: true });

  const live = request.nextUrl.searchParams.get("live") === "1";
  try {
    // A pin near a demo center gets the saved response. Without the file, it's analyzed as before.
    const saved = live ? null : await savedAnalysis(point.lat, point.lng);
    return Response.json(saved ?? (await analyzeArea(point.lat, point.lng, { live })));
  } catch (error) {
    if (error instanceof AreaUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error("analyze: failed", error);
    return Response.json(
      { error: "Couldn't analyze this area. Try again in a moment." },
      { status: 500 },
    );
  }
}
