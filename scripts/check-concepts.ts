// Checks generateConcepts on the Santa Monica sample.
// Run: npx tsx --env-file=.env.local scripts/check-concepts.ts
// Always runs the validation and retry checks against canned model responses (no API calls).
// With ANTHROPIC_API_KEY set, it also calls Claude once on the sample, prints the concepts and checks them.
// Add --prompt to print the prompt sent to Claude.

import Anthropic from "@anthropic-ai/sdk";
import { GAP_TYPES } from "../src/lib/analysis/candidates";
import {
  ConceptsError,
  generateConcepts,
  generateConceptsWith,
  type ConceptsReply,
  type SendConceptsRequest,
} from "../src/lib/analysis/concepts";
import { CLAUDE_MODEL } from "../src/lib/claude";
import { emptyCounts } from "../src/lib/ingest/categories";
import { mockAnalysis } from "../src/lib/mock";
import type { AreaData, Concept, Gap } from "../src/lib/types";

type CreateParams = Parameters<SendConceptsRequest>[0];

const sample = mockAnalysis({ lat: 34.0195, lng: -118.4912 });
// Counts come from OpenStreetMap only, as in collectArea.
const categoryCounts = emptyCounts();
for (const b of sample.businesses) if (b.id.startsWith("osm:")) categoryCounts[b.category] += 1;
const area: AreaData = {
  center: sample.center,
  radiusM: sample.radiusM,
  businesses: sample.businesses,
  demographics: sample.demographics,
  categoryCounts,
  docs: sample.docs,
  errors: [],
};
const gaps: Gap[] = sample.gaps;
const goodConcepts: Concept[] = sample.concepts;

let failures = 0;
function check(condition: boolean, message: string) {
  console.log(`  ${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failures += 1;
}

// Checks the rules a route can rely on, for canned and live results alike.
function checkRules(concepts: Concept[], forGaps: Gap[]) {
  const gapCategories = new Set(forGaps.map((g) => g.category));
  const docIds = new Set(area.docs.map((d) => d.id));
  check(concepts.length === 3, `exactly 3 concepts (got ${concepts.length})`);
  check(
    concepts.every((c) => gapCategories.has(c.category)),
    `every category is a gap: ${concepts.map((c) => c.category).join(", ")}`,
  );
  check(new Set(concepts.map((c) => c.category)).size === concepts.length, "categories are distinct");
  check(
    concepts.every((c) => c.evidence.length > 0 && c.evidence.every((id) => docIds.has(id))),
    "every concept cites at least one id, and every id is in area.docs",
  );
  check(
    concepts.every((c) => c.title && c.rationale && c.risk),
    "every concept has a title, rationale and risk",
  );
}

// Canned replies, played back in order. Each one is a reply or an error to throw.
function scripted(...replies: (ConceptsReply | Error)[]) {
  const calls: CreateParams[] = [];
  const send: SendConceptsRequest = async (params) => {
    calls.push(params);
    const next = replies.shift();
    if (!next) throw new Error("the canned replies ran out");
    if (next instanceof Error) throw next;
    return next;
  };
  return { send, calls };
}

function reply(body: unknown, stop_reason: ConceptsReply["stop_reason"] = "end_turn"): ConceptsReply {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    content: [{ type: "text", text, citations: null }],
    stop_reason,
    stop_details: null,
    model: CLAUDE_MODEL,
  };
}

const withConcepts = (concepts: unknown[]) => reply({ concepts });

async function expectError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

function printConcepts(concepts: Concept[]) {
  for (const c of concepts) {
    console.log(`\n  ${c.title} [${c.category}]`);
    console.log(`    Rationale: ${c.rationale}`);
    console.log(`    Evidence:  ${c.evidence.join(", ")}`);
    console.log(`    Risk:      ${c.risk}`);
  }
  console.log();
}

function userText(params: CreateParams): string {
  const content = params.messages[0]?.content;
  if (typeof content === "string") return content;
  return (content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

async function cannedChecks() {
  console.log("Valid reply");
  {
    const { send, calls } = scripted(withConcepts(goodConcepts));
    const concepts = await generateConceptsWith(send, area, gaps);
    checkRules(concepts, gaps);
    check(calls.length === 1, "one call");
    const params = calls[0];
    check(params.model === CLAUDE_MODEL, `model is ${CLAUDE_MODEL}`);
    check(params.output_config?.effort === "low", "effort is low");
    check(params.output_config?.format?.type === "json_schema", "structured output with a JSON schema");
    check(params.fallbacks === "default" && params.betas?.includes("server-side-fallback-2026-07-01") === true, "fallbacks are on");
    const prompt = userText(params);
    check(prompt.includes("laundry | 0 | 0.00 | 0.21 | 1.18"), "gap table row for laundry");
    check(prompt.includes("[review:sample-ocean-kitchen:0]") && prompt.includes("[census:06037701801]"), "prompt lists doc ids");
    const system = typeof params.system === "string" ? params.system : "";
    console.log(`  Prompt: ${system.length + prompt.length} chars, about ${Math.round((system.length + prompt.length) / 4)} tokens`);
    if (process.argv.includes("--prompt")) console.log(`
${system}

${prompt}
`);
    printConcepts(concepts);
  }

  console.log("Unknown evidence ids are dropped");
  {
    const concepts = goodConcepts.map((c, i) => (i === 0 ? { ...c, evidence: [...c.evidence, "osm:node/404", "review:made-up:0"] } : c));
    const { send, calls } = scripted(withConcepts(concepts));
    const result = await generateConceptsWith(send, area, gaps);
    checkRules(result, gaps);
    check(calls.length === 1, "no retry needed");
    check(!result[0].evidence.includes("osm:node/404"), "the unknown id is gone");
  }

  console.log("A category outside the gaps triggers one retry");
  {
    const bad = goodConcepts.map((c, i) => (i === 2 ? { ...c, category: "bar" } : c));
    const { send, calls } = scripted(withConcepts(bad), withConcepts(goodConcepts));
    const result = await generateConceptsWith(send, area, gaps);
    checkRules(result, gaps);
    check(calls.length === 2, "two calls");
    const retry = userText(calls[1]);
    check(retry.includes('category "bar"'), "the retry says what was wrong");
    check(retry.startsWith(userText(calls[0])), "the retry keeps the same area text first, so the cache prefix matches");
  }

  console.log("A concept citing only unknown ids triggers a retry");
  {
    const bad = goodConcepts.map((c, i) => (i === 1 ? { ...c, evidence: ["census:00000000000"] } : c));
    const { send, calls } = scripted(withConcepts(bad), withConcepts(goodConcepts));
    checkRules(await generateConceptsWith(send, area, gaps), gaps);
    check(calls.length === 2, "two calls");
  }

  console.log("Truncated output (max_tokens) triggers a retry");
  {
    const { send, calls } = scripted(reply('{"concepts": [{"title": "Laund', "max_tokens"), withConcepts(goodConcepts));
    checkRules(await generateConceptsWith(send, area, gaps), gaps);
    check(calls.length === 2, "two calls");
    check(userText(calls[1]).includes("max_tokens"), "the retry mentions the cutoff");
  }

  console.log("Two invalid replies throw ConceptsError");
  {
    const { send, calls } = scripted(withConcepts(goodConcepts.slice(0, 2)), reply("not json"));
    const error = await expectError(generateConceptsWith(send, area, gaps));
    check(error instanceof ConceptsError, `throws ConceptsError: ${(error as Error)?.message}`);
    check(calls.length === 2, "stops after one retry");
  }

  console.log("Duplicate categories are rejected when there are 3+ gaps");
  {
    const dup = goodConcepts.map((c, i) => (i === 2 ? { ...c, category: "laundry" } : c));
    const { send } = scripted(withConcepts(dup), withConcepts(dup));
    check((await expectError(generateConceptsWith(send, area, gaps))) instanceof ConceptsError, "throws after the retry");
  }

  console.log("With fewer than 3 gaps, concepts may share a category");
  {
    const twoGaps = gaps.slice(0, 2);
    const shared = goodConcepts.map((c, i) => (i === 2 ? { ...c, category: "laundry" } : c));
    const { send, calls } = scripted(withConcepts(shared));
    const result = await generateConceptsWith(send, area, twoGaps);
    check(result.length === 3 && calls.length === 1, "accepted on the first try");
  }

  console.log("Typed gaps are kept at score 0, and the prompt gives their types and facts");
  {
    const typed = [
      { ...gaps[0], gapType: "mismatched" as const, facts: ["None of the 5 laundromats within 2 km that list hours is open after 9 pm"] },
      { ...gaps[1], gapType: "unserved" as const, facts: ["0 childcare centers in the circle"] },
      { ...gaps[2], score: 0, gapType: "poorly_served" as const, facts: ["6 rated hardware stores within 2 km average 3.4 stars"] },
    ];
    const { send, calls } = scripted(withConcepts(goodConcepts));
    checkRules(await generateConceptsWith(send, area, typed), typed);
    const prompt = userText(calls[0]);
    check(prompt.includes("hardware | 0 | 0.00 | 0.12 | 0.00 | poorly_served"), "gap table row has the type");
    check(prompt.includes("- 6 rated hardware stores within 2 km average 3.4 stars"), "prompt lists the facts");
    const system = typeof calls[0].system === "string" ? calls[0].system : "";
    check(GAP_TYPES.every((t) => system.includes(`- ${t}:`)), "system prompt explains each gap type");
  }

  console.log("A refusal throws without a retry");
  {
    const refusal: ConceptsReply = {
      content: [],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "general_harms", explanation: null } as ConceptsReply["stop_details"],
      model: CLAUDE_MODEL,
    };
    const { send, calls } = scripted(refusal, withConcepts(goodConcepts));
    const error = await expectError(generateConceptsWith(send, area, gaps));
    check(error instanceof ConceptsError, `throws ConceptsError: ${(error as Error)?.message}`);
    check(calls.length === 1, "no retry");
  }

  console.log("A transient API error is retried once");
  {
    const { send, calls } = scripted(new Anthropic.APIConnectionTimeoutError(), withConcepts(goodConcepts));
    checkRules(await generateConceptsWith(send, area, gaps), gaps);
    check(calls.length === 2, "two calls");
  }

  console.log("A non-retryable API error throws ConceptsError right away");
  {
    const badRequest = new Anthropic.BadRequestError(400, undefined, "invalid request", new Headers());
    const { send, calls } = scripted(badRequest, withConcepts(goodConcepts));
    const error = await expectError(generateConceptsWith(send, area, gaps));
    check(error instanceof ConceptsError && (error as ConceptsError).cause === badRequest, "wraps the API error");
    check(calls.length === 1, "no retry");
  }

  console.log("No gaps returns [] without calling Claude");
  {
    const { send, calls } = scripted();
    const empty = await generateConceptsWith(send, { ...area, demographics: null }, []);
    const overserved = await generateConceptsWith(send, area, gaps.map((g) => ({ ...g, score: -g.score })));
    check(empty.length === 0 && overserved.length === 0, "returns []");
    check(calls.length === 0, "no calls");
  }
}

async function liveCheck() {
  console.log(`Live: ${CLAUDE_MODEL} on the Santa Monica sample`);
  const started = Date.now();
  try {
    const concepts = await generateConcepts(area, gaps);
    console.log(`  Took ${((Date.now() - started) / 1000).toFixed(1)} s`);
    printConcepts(concepts);
    checkRules(concepts, gaps);
  } catch (error) {
    check(false, `generateConcepts threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  await cannedChecks();
  if (process.env.ANTHROPIC_API_KEY) {
    await liveCheck();
  } else {
    console.log("\nSkipped the live check: ANTHROPIC_API_KEY is not set (add it to .env.local).");
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
