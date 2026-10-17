import { cacheLife } from "next/cache";
import { SUGGESTIONS } from "@/lib/suggestions";
import { savedThread } from "@/lib/suggestions/saved";

// GET /api/suggestions/<id>: a search suggestion's saved thread (scripts/save-suggestions.ts), the place's
// analysis with the question answered. Every one is prerendered at build time, so opening a suggestion is
// a static fetch with no Claude, Places or Overpass call.
export const dynamicParams = false;

export function generateStaticParams() {
  return SUGGESTIONS.map(({ id }) => ({ id }));
}

async function thread(id: string) {
  "use cache";
  cacheLife("max");
  return savedThread(id);
}

export async function GET(_request: Request, { params }: RouteContext<"/api/suggestions/[id]">) {
  const saved = await thread((await params).id);
  if (!saved) return Response.json({ error: "This suggestion has no saved thread yet." }, { status: 404 });
  return Response.json(saved);
}
