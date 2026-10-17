import { answerQuestion } from "@/lib/ask/answer";
// useMocks isn't a React hook; the alias keeps the rules-of-hooks lint from flagging it.
import { mockAnswer, useMocks as mocksEnabled } from "@/lib/mock";
import type { AskRequest, ChatTurn, SourceDoc } from "@/lib/types";

// A low-effort answer usually takes well under 15 s; answerQuestion gives up after 50 s.
export const maxDuration = 60;

const MAX_QUESTION_CHARS = 2000;
// A dense area has a few hundred docs. These caps bound the cost of one question (about 150k input tokens).
const MAX_DOCS = 1500;
const MAX_DOC_CHARS = 600_000;
const MAX_HISTORY_TURNS = 100;

type Parsed = { ask: AskRequest } | { error: string; status: 400 | 413 };

function isDoc(value: unknown): value is SourceDoc {
  if (typeof value !== "object" || value === null) return false;
  const { id, source, url, title, text } = value as Record<string, unknown>;
  return [id, source, url, title, text].every((field) => typeof field === "string") && id !== "";
}

function isTurn(value: unknown): value is ChatTurn {
  if (typeof value !== "object" || value === null) return false;
  const { role, content } = value as Record<string, unknown>;
  return (role === "user" || role === "assistant") && typeof content === "string";
}

function parseAsk(body: unknown): Parsed {
  const invalid: Parsed = {
    error: `Send JSON with a question (up to ${MAX_QUESTION_CHARS} characters), a docs array and an optional history array.`,
    status: 400,
  };
  if (typeof body !== "object" || body === null) return invalid;
  const { question, docs, history } = body as Record<string, unknown>;
  if (typeof question !== "string") return invalid;
  const trimmed = question.trim();
  if (!trimmed || trimmed.length > MAX_QUESTION_CHARS) return invalid;
  if (!Array.isArray(docs) || !docs.every(isDoc)) return invalid;
  if (history !== undefined && (!Array.isArray(history) || !history.every(isTurn))) return invalid;

  const docChars = docs.reduce((sum, doc) => sum + doc.id.length + doc.title.length + doc.text.length, 0);
  if (docs.length > MAX_DOCS || docChars > MAX_DOC_CHARS || (history?.length ?? 0) > MAX_HISTORY_TURNS) {
    return {
      error: `Send at most ${MAX_DOCS} docs, ${MAX_DOC_CHARS} characters of doc text and ${MAX_HISTORY_TURNS} history turns.`,
      status: 413,
    };
  }
  return { ask: { question: trimmed, docs, history } };
}

export async function POST(request: Request) {
  const parsed = parseAsk(await request.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.status });
  const { ask } = parsed;

  if (mocksEnabled()) return Response.json(mockAnswer(ask.question, ask.docs));

  try {
    return Response.json(await answerQuestion(ask));
  } catch (error) {
    console.error("ask: Claude call failed", error);
    return Response.json({ error: "Couldn't get an answer from Claude. Try again in a moment." }, { status: 502 });
  }
}
