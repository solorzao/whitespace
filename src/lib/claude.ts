import Anthropic from "@anthropic-ai/sdk";

// Per PROJECT_PLAN.md. Switch to "claude-sonnet-5-5" if the analysis is too slow for the demo.
export const CLAUDE_MODEL = "claude-opus-5-5";

let client: Anthropic | undefined;

// Created on first use so builds and mocked runs don't need ANTHROPIC_API_KEY.
export function claude(): Anthropic {
  client ??= new Anthropic();
  return client;
}
