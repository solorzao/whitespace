import type { SourceDoc } from "../types";
import { errorMessage } from "./http";

// Adapters return an error instead of throwing, so one failing source can't take down the rest.
export type AdapterResult<T> =
  | { ok: true; docs: SourceDoc[]; data: T }
  | { ok: false; error: string };

export async function settle<T>(
  run: () => Promise<{ docs: SourceDoc[]; data: T }>,
): Promise<AdapterResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export const USER_AGENT =
  "Whitespace/0.1 (hackathon project; https://github.com/solorzao/whitespace)";
