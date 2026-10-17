import { connection } from "next/server";
import { collectArea, AreaUnavailableError, DEMO_AREAS } from "@/lib/ingest";
import { demoFilePath, readSaved } from "@/lib/ingest/saved";
import { parsePoint } from "@/lib/point";
import { mockAnalysis, useMocks as mocksEnabled } from "@/lib/mock";
import { mapRecords } from "@/components/explorer/data";
import type { AreaData } from "@/lib/types";

export const maxDuration = 40;

// Only saved, collected source coordinates seed the globe. Opening it makes no provider calls.
export async function GET() {
  await connection();
  const snapshots = await Promise.all(
    DEMO_AREAS.map((area) => readSaved<AreaData>(demoFilePath(area))),
  );
  return Response.json({
    areas: DEMO_AREAS.map((area, i) => ({
      ...area,
      available: snapshots[i] !== null,
    })),
    records: [
      ...new Map(
        snapshots
          .flatMap((area) => mapRecords(area?.docs ?? []))
          .map((record) => [record.id, record]),
      ).values(),
    ],
  });
}

// Load evidence for selection without making any model calls.
export async function POST(request: Request) {
  const point = parsePoint(await request.json().catch(() => null));
  if (!point)
    return Response.json(
      { error: "Send JSON with numeric lat and lng." },
      { status: 400 },
    );
  if (mocksEnabled()) {
    const analysis = mockAnalysis(point);
    return Response.json({
      ...analysis,
      categoryCounts: {},
      errors: [],
      from: "mock",
      mock: true,
    });
  }
  try {
    return Response.json(await collectArea(point.lat, point.lng));
  } catch (error) {
    if (error instanceof AreaUnavailableError)
      return Response.json({ error: error.message }, { status: 503 });
    console.error("area: failed", error);
    return Response.json(
      { error: "Could not load sources for this area. Please try again." },
      { status: 500 },
    );
  }
}
