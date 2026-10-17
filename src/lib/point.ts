import type { LatLng } from "./types";

export function parsePoint(body: unknown): LatLng | null {
  if (!body || typeof body !== "object") return null;
  const { lat, lng } = body as Record<string, unknown>;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  return { lat, lng };
}
