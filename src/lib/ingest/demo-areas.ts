import type { LatLng } from "../types";
import { distanceM } from "./geo";

export type DemoArea = {
  slug: string; // saved as data/demo/<slug>.json
  name: string;
  center: LatLng;
};

export const DEMO_AREAS: DemoArea[] = [
  { slug: "santa-monica", name: "Santa Monica", center: { lat: 34.0195, lng: -118.4912 } },
  { slug: "lower-manhattan", name: "Lower Manhattan", center: { lat: 40.7075, lng: -74.0113 } },
];

// A pin this close to a demo center snaps to it and uses the saved data.
export const SNAP_RADIUS_M = 300;

export const AREA_RADIUS_M = 800;
export const WIKIPEDIA_RADIUS_M = 1500;

export function findDemoArea(point: LatLng): DemoArea | null {
  for (const area of DEMO_AREAS) {
    if (distanceM(area.center, point) <= SNAP_RADIUS_M) return area;
  }
  return null;
}

export function getDemoArea(slug: string): DemoArea | null {
  return DEMO_AREAS.find((a) => a.slug === slug) ?? null;
}
