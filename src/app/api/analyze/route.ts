import { analyzeArea } from "@/lib/analysis";
import { AreaUnavailableError } from "@/lib/ingest";
// useMocks isn't a React hook; the alias keeps the rules-of-hooks lint from flagging it.
import { mockAnalysis, useMocks as mocksEnabled } from "@/lib/mock";
import type { AnalyzeRequest } from "@/lib/types";

// The concepts call budgets 75 s, and the competitor search and tagging run alongside it. Demo pins
// read saved area data, so most of this goes to Claude; a live area adds the data sources' time.
export const maxDuration = 120;

function parsePoint(body: unknown): AnalyzeRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { lat, lng } = body as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export async function POST(request: Request) {
  const point = parsePoint(await request.json().catch(() => null));
  if (!point) {
    return Response.json({ error: "Send JSON with numeric lat and lng." }, { status: 400 });
  }

  if (mocksEnabled()) return Response.json(mockAnalysis(point));

  try {
    return Response.json(await analyzeArea(point.lat, point.lng));
  } catch (error) {
    if (error instanceof AreaUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error("analyze: failed", error);
    return Response.json({ error: "Couldn't analyze this area. Try again in a moment." }, { status: 500 });
  }
}
