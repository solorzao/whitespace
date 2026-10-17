// The saved demo areas in data/demo/. Node only (reads files), so client code shouldn't import it.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DemoArea } from "./demo-areas";

export const DEMO_DIR = path.join(process.cwd(), "data", "demo");

export function demoFilePath(area: DemoArea): string {
  return path.join(DEMO_DIR, `${area.slug}.json`);
}

export function categoryReviewsFilePath(area: DemoArea): string {
  return path.join(DEMO_DIR, `${area.slug}-category-reviews.json`);
}

// null when the file doesn't exist yet.
export async function readSaved<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
