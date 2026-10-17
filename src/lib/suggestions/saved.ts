// The saved threads behind the search menu's suggestions, written by scripts/save-suggestions.ts.
// Each place's analysis is saved once and shared by its suggestions: the demo areas reuse
// data/demo/<slug>-analysis.json, and the other places have data/suggestions/<slug>-analysis.json.
// The answers are all in data/suggestions/answers.json. Node only (reads files), so client code
// shouldn't import it.

import path from "node:path";
import type { Report } from "../../components/explorer/types";
import type { AnalysisResult } from "../analysis";
import { DEMO_AREAS } from "../ingest/demo-areas";
import { DEMO_DIR, readSaved } from "../ingest/saved";
import type { AskResponse } from "../types";
import { findSuggestion, threadId, type SuggestionPlace } from "./index";

export const SUGGESTIONS_DIR = path.join(process.cwd(), "data", "suggestions");
export const ANSWERS_FILE = path.join(SUGGESTIONS_DIR, "answers.json");

// Keyed by suggestion id. The question is saved with its answer, so a reworded suggestion isn't
// served an answer to its old wording.
export type SavedAnswer = { question: string; response: AskResponse; createdAt: string };
export type SavedAnswers = Record<string, SavedAnswer>;

// A saved thread is shown as finished research, so its answer and cards never talk about the evidence
// behind them (missing data, documents, sources). save-suggestions.ts won't save an answer that does.
export const CAVEAT =
  /\b(documents?|data|dataset|sources?|samples?|not enough|no information|unavailable|don't (?:cover|show|include))\b/i;

export function isDemoPlace(place: SuggestionPlace): boolean {
  return DEMO_AREAS.some((a) => a.slug === place.slug);
}

export function placeAnalysisPath(place: SuggestionPlace): string {
  return path.join(isDemoPlace(place) ? DEMO_DIR : SUGGESTIONS_DIR, `${place.slug}-analysis.json`);
}

// The suggestion's thread, in the shape the explorer stores (Report): the place's analysis with the
// question already answered. null when the analysis or a current answer isn't saved.
export async function savedThread(id: string): Promise<Report | null> {
  const suggestion = findSuggestion(id);
  if (!suggestion) return null;
  const [answers, analysis] = await Promise.all([
    readSaved<SavedAnswers>(ANSWERS_FILE),
    readSaved<AnalysisResult>(placeAnalysisPath(suggestion.place)),
  ]);
  const answer = answers?.[id];
  if (!analysis || !answer || answer.question !== suggestion.question) return null;
  return {
    id: threadId(id),
    name: suggestion.place.name,
    question: suggestion.question,
    createdAt: answer.createdAt,
    analysis: { ...analysis, from: "saved" },
    conversation: [{ question: suggestion.question, response: answer.response }],
  };
}
