import { mockAnalysis } from "@/lib/mock";
import type { AnalyzeRequest } from "@/lib/types";

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

  // TODO(oliver): replace with collectArea + scoreGaps + the Claude analysis; keep mocks behind useMocks().
  return Response.json(mockAnalysis(point));
}
