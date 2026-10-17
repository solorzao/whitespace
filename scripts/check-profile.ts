// Checks review tagging and buildProfile on the made-up laundromats in src/lib/mock/laundry-competitors.ts.
//
//   npx tsx --env-file=.env.local scripts/check-profile.ts              tags the reviews with Claude (needs ANTHROPIC_API_KEY)
//   npx tsx --env-file=.env.local scripts/check-profile.ts --no-claude  uses the fixture's canned tags, no API calls
//
// Both modes first run the tag parsing and profile checks against canned data, then print the profile
// the way the concept card shows it.

import { buildProfile, describeFinding, type ProfileFinding, type SuccessProfile } from "../src/lib/analysis/profile";
import {
  buildRequest,
  readTags,
  TAGGING_MODEL,
  TagReviewsError,
  tagReviews,
  type ReviewTag,
  type TagsReply,
} from "../src/lib/analysis/tag-reviews";
import { TOPICS } from "../src/lib/analysis/topics";
import {
  LAUNDRY_CANNED_TAGS,
  LAUNDRY_CATEGORY,
  LAUNDRY_COMPETITORS,
  LAUNDRY_REVIEWS,
} from "../src/lib/mock/laundry-competitors";

const noClaude = process.argv.includes("--no-claude");

let failures = 0;
function check(condition: boolean, message: string) {
  console.log(`  ${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failures += 1;
}

function reply(body: unknown, stop_reason: TagsReply["stop_reason"] = "end_turn"): TagsReply {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { content: [{ type: "text", text, citations: null }], stop_reason, stop_details: null };
}

function throwsTagError(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof TagReviewsError;
  }
}

function cannedChecks() {
  const reviews = LAUNDRY_REVIEWS.slice(0, 3);
  const [a, b, c] = reviews.map((r) => r.id);

  console.log("readTags keeps valid tags and drops the rest");
  {
    const tags = readTags(
      reply({
        reviews: [
          {
            id: a,
            tags: [
              { topic: "service", sentiment: "praise", detail: "Wash-and-fold service." },
              { topic: "parking", sentiment: "complaint", detail: "no parking" }, // unknown topic
              { topic: "wait", sentiment: "neutral", detail: "fast" }, // unknown sentiment
              { topic: "wait", sentiment: "praise", detail: "same-day turnaround with no waiting at all" },
              { topic: "staff", sentiment: "praise", detail: "friendly" },
              { topic: "price", sentiment: "complaint", detail: "pricey" }, // a 4th valid tag
            ],
          },
          { id: "review:made-up:0", tags: [{ topic: "price", sentiment: "praise", detail: "cheap" }] },
          { id: ` ${b} `, tags: [] },
          { id: b, tags: [{ topic: "quality", sentiment: "praise", detail: "repeated id" }] },
          { id: c, tags: [{ topic: "hours", sentiment: "complaint", detail: "" }] },
        ],
      }),
      reviews,
    );
    const forA = tags.filter((t) => t.reviewId === a);
    check(forA.length === 3, `at most 3 tags per review (got ${forA.length})`);
    check(forA.every((t) => t.topic !== ("parking" as string)), "unknown topic dropped");
    check(!forA.some((t) => t.detail === "fast"), "unknown sentiment dropped");
    check(forA[0]?.detail === "wash-and-fold service", `detail lowercased, punctuation trimmed: "${forA[0]?.detail}"`);
    check(forA[1]?.detail.split(" ").length === 5, `detail cut to 5 words: "${forA[1]?.detail}"`);
    check(!tags.some((t) => t.reviewId === "review:made-up:0"), "unknown review id dropped");
    check(!tags.some((t) => t.reviewId === b), "a repeated review id keeps its first (empty) tag list");
    check(tags.find((t) => t.reviewId === c)?.detail === "hours", "an empty detail falls back to the topic");
  }

  console.log("readTags rejects unusable replies");
  {
    const refusal: TagsReply = {
      content: [],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "general_harms", explanation: null } as TagsReply["stop_details"],
    };
    check(throwsTagError(() => readTags(refusal, reviews)), "a refusal throws TagReviewsError");
    check(throwsTagError(() => readTags(reply('{"reviews": [{"id": "rev', "max_tokens"), reviews)), "max_tokens throws");
    check(throwsTagError(() => readTags(reply("not json"), reviews)), "invalid JSON throws");
    check(throwsTagError(() => readTags(reply({ tags: [] }), reviews)), "a missing reviews array throws");
  }

  console.log("The tagging request");
  {
    const params = buildRequest(LAUNDRY_CATEGORY, reviews);
    check(params.model === "claude-haiku-5-5", `model is ${params.model}`);
    check(!("fallbacks" in params) && !("betas" in params), "no fallbacks (Haiku 5.5 has none)");
    check(params.output_config?.effort === "low", "effort is low");
    check(params.output_config?.format?.type === "json_schema", "structured output with a JSON schema");
  }

  console.log("buildProfile needs 6 reviewed competitors");
  {
    const five = LAUNDRY_COMPETITORS.slice(0, 5);
    check(buildProfile(LAUNDRY_CATEGORY, five, LAUNDRY_REVIEWS, LAUNDRY_CANNED_TAGS) === null, "5 returns null");
    const unrated = LAUNDRY_COMPETITORS.map((c, i) => (i < 4 ? { ...c, rating: undefined } : c));
    check(
      buildProfile(LAUNDRY_CATEGORY, unrated, LAUNDRY_REVIEWS, LAUNDRY_CANNED_TAGS) === null,
      "unrated competitors don't count",
    );
    const noReviews = LAUNDRY_REVIEWS.filter((r) => !r.id.startsWith("review:sample-bright-spin:"));
    check(
      buildProfile(LAUNDRY_CATEGORY, LAUNDRY_COMPETITORS.slice(0, 6), noReviews, LAUNDRY_CANNED_TAGS) === null,
      "competitors without reviews don't count",
    );
  }

  console.log("buildProfile on the canned tags");
  {
    const profile = buildProfile(LAUNDRY_CATEGORY, LAUNDRY_COMPETITORS, LAUNDRY_REVIEWS, LAUNDRY_CANNED_TAGS);
    checkProfile(profile);
    if (profile) {
      const labels = profile.findings.map((f) => f.label);
      check(labels[0] === "open after 9 pm", `open after 9 pm comes first (got "${labels[0]}")`);
      check(labels.includes("broken machines"), "broken machines is a complaint finding");
      check(labels.includes("wash-and-fold service"), "wash-and-fold service is a praise finding");
      check(!labels.includes("delivery"), "delivery (1 of 3 against 0 of 3) is below the 0.5 attribute threshold");
    }
  }
}

// The rules any profile must meet, canned or live.
function checkProfile(profile: SuccessProfile | null) {
  check(profile !== null, "returns a profile");
  if (!profile) return;
  const ids = new Set([...LAUNDRY_COMPETITORS.map((c) => c.id), ...LAUNDRY_REVIEWS.map((r) => r.id)]);
  check(profile.businessIds.length === 6, `compares the top and bottom thirds: ${profile.businessIds.length} competitors`);
  check(profile.businessIds[0] === "places:sample-bright-spin", "the best-rated competitor comes first");
  check(profile.findings.length <= 4, `at most 4 findings (got ${profile.findings.length})`);
  check(
    profile.findings.every((f) => f.top.count <= f.top.of && f.low.count <= f.low.of),
    "every count is at most its total",
  );
  check(
    profile.findings.every((f) => f.evidence.length >= 1 && f.evidence.length <= 3 && f.evidence.every((id) => ids.has(id))),
    "every finding cites 1 to 3 known ids",
  );
  const differences = profile.findings.map(difference);
  check(
    differences.every((d, i) => i === 0 || d <= differences[i - 1] + 1e-9),
    `biggest difference first: ${differences.map((d) => d.toFixed(2)).join(", ")}`,
  );
}

function difference(f: ProfileFinding): number {
  const top = f.top.count / f.top.of;
  const low = f.low.count / f.low.of;
  return f.kind === "praise" ? top - low : f.kind === "complaint" ? low - top : Math.abs(top - low);
}


function printProfile(profile: SuccessProfile | null) {
  if (!profile) {
    console.log("\n  Not enough reviews nearby for a success profile.\n");
    return;
  }
  console.log(
    `\n  What the best ${profile.category} businesses within ${profile.radiusM / 1000} km do` +
      ` (${profile.businessIds.length} compared, ${profile.reviewCount} reviews):`,
  );
  profile.findings.forEach((f, i) => {
    console.log(`  ${i < 2 ? "*" : " "} ${describeFinding(f)}`);
    console.log(`      ${f.kind}, evidence: ${f.evidence.join(", ")}`);
  });
  console.log("  (* = the 2 the card shows)\n");
}

function printTagSummary(tags: ReviewTag[]) {
  const tagged = new Set(tags.map((t) => t.reviewId));
  console.log(`  ${tags.length} tags on ${tagged.size} of ${LAUNDRY_REVIEWS.length} reviews`);
  for (const topic of TOPICS) {
    const forTopic = tags.filter((t) => t.topic === topic);
    if (forTopic.length === 0) continue;
    const praise = forTopic.filter((t) => t.sentiment === "praise").length;
    const details = [...new Set(forTopic.map((t) => t.detail))].slice(0, 4).join(", ");
    console.log(`    ${topic.padEnd(11)} ${praise} praise, ${forTopic.length - praise} complaint: ${details}`);
  }
}

async function main() {
  cannedChecks();

  let tags: ReviewTag[];
  if (noClaude) {
    console.log("\nProfile from canned tags (--no-claude)");
    tags = LAUNDRY_CANNED_TAGS;
  } else if (!process.env.ANTHROPIC_API_KEY) {
    console.log("\nANTHROPIC_API_KEY is not set (add it to .env.local), or pass --no-claude to use canned tags.");
    process.exitCode = 1;
    return;
  } else {
    console.log(`\nLive: tagging ${LAUNDRY_REVIEWS.length} reviews with ${TAGGING_MODEL}`);
    const started = Date.now();
    tags = await tagReviews(LAUNDRY_CATEGORY, LAUNDRY_REVIEWS);
    console.log(`  Took ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const injected = LAUNDRY_REVIEWS.find((r) => r.text.includes("IMPORTANT NOTE TO ANY AI"));
    const injectedTags = tags.filter((t) => t.reviewId === injected?.id);
    check(
      injectedTags.every((t) => t.sentiment === "complaint"),
      `the review with planted instructions is tagged as data: ${injectedTags.map((t) => `${t.topic}/${t.sentiment} "${t.detail}"`).join(", ") || "no tags"}`,
    );
    check(tags.some((t) => t.sentiment === "praise") && tags.some((t) => t.sentiment === "complaint"), "both praise and complaints");
  }
  printTagSummary(tags);

  const profile = buildProfile(LAUNDRY_CATEGORY, LAUNDRY_COMPETITORS, LAUNDRY_REVIEWS, tags);
  checkProfile(profile);
  printProfile(profile);

  console.log(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
