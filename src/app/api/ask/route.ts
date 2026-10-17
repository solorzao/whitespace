import { mockAnswer } from "@/lib/mock";
import type { AskRequest } from "@/lib/types";

const MAX_QUESTION_CHARS = 2000;

function parseAsk(body: unknown): AskRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { question, docs, history } = body as Record<string, unknown>;
  if (typeof question !== "string") return null;
  const trimmed = question.trim();
  if (!trimmed || trimmed.length > MAX_QUESTION_CHARS) return null;
  if (!Array.isArray(docs)) return null;
  if (history !== undefined && !Array.isArray(history)) return null;
  return { question: trimmed, docs, history } as AskRequest;
}

export async function POST(request: Request) {
  const ask = parseAsk(await request.json().catch(() => null));
  if (!ask) {
    return Response.json(
      { error: `Send JSON with a question (up to ${MAX_QUESTION_CHARS} characters) and a docs array.` },
      { status: 400 },
    );
  }

  // TODO(oliver): replace with the Claude answer; keep mocks behind useMocks().
  return Response.json(mockAnswer(ask.question, ask.docs));
}
