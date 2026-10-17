import type { MapRecord, MapPoint } from "../types";

export interface Globe {
  setProgress(value: number): void;
  setPaused(value: boolean): void;
  setRecords(records: MapRecord[]): void;
  filter(types: Set<number>): void;
  focus(
    point: MapPoint,
    options?: { radiusKm?: number; selectPoint?: boolean },
  ): number;
  setRegionRadius(radius: number | null): void;
  clearSelection(): void;
  zoom(delta: number): void;
  reset(): void;
  startResearch(point: MapPoint): void;
  stopResearch(): void;
  dispose(): void;
}

export function createGlobe(
  container: HTMLElement,
  overlay: HTMLCanvasElement,
  callbacks: {
    select(point: MapPoint): void;
    move(): void;
    hover(point: { x: number; y: number; text: string } | null): void;
    scale(km: number): void;
    imagery(visible: boolean): void;
    reference(visible: boolean): void;
  },
): Promise<Globe>;
