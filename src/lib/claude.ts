import Anthropic from "@anthropic-ai/sdk";

// Every Claude call (review tagging, concepts, follow-up answers) uses Haiku 5.5: fast and cheap enough
// for a live demo. Haiku 5.5 has no server-side fallback, so the calls send no `fallbacks`; a safety
// decline comes back as stop_reason "refusal" and each call handles it.
export const CLAUDE_MODEL = "claude-haiku-5-5";

let client: Anthropic | undefined;

// Created on first use so builds and mocked runs don't need ANTHROPIC_API_KEY.
export function claude(): Anthropic {
  client ??= new Anthropic();
  return client;
}
