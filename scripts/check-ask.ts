// Checks the /api/ask answers against the Santa Monica sample docs.
//
//   npx tsx --env-file=.env.local scripts/check-ask.ts   canned checks, then live questions to Claude
//   npx tsx scripts/check-ask.ts                         canned checks only (no ANTHROPIC_API_KEY)
//
// The canned checks run the citation parsing, renumbering and stop-reason handling on made-up model
// replies. The live checks ask real questions, including one the docs can't answer.

import { answerQuestion, buildMessages, REFUSAL_ANSWER, toAskResponse } from "../src/lib/ask/answer";
import { mockAnalysis } from "../src/lib/mock";
import type { AskResponse, ChatTurn } from "../src/lib/types";

const docs = mockAnalysis({ lat: 34.0195, lng: -118.4912 }).docs;
const docsById = new Map(docs.map((doc) => [doc.id, doc]));
let failures = 0;

function check(ok: boolean, label: string) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

// Every citation is a request doc, cited once, and the [n] markers are exactly 1..citations.length,
// first used in that order.
function checkCitations(response: AskResponse, label: string) {
  check(
    response.citations.every((c) => {
      const doc = docsById.get(c.id);
      return doc !== undefined && doc.title === c.title && doc.url === c.url;
    }),
    `${label}: every citation is a request doc with its title and url`,
  );
  check(
    new Set(response.citations.map((c) => c.id)).size === response.citations.length,
    `${label}: no doc is cited twice`,
  );
  const used = [...response.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const firstUses = [...new Set(used)];
  check(
    firstUses.length === response.citations.length && firstUses.every((n, i) => n === i + 1),
    `${label}: [n] markers match the citations (${firstUses.join(",") || "none"} for ${response.citations.length})`,
  );
}

type Reply = Parameters<typeof toAskResponse>[0];
const reply = (stop_reason: Reply["stop_reason"], text?: string): Reply => ({
  stop_reason,
  stop_details: null,
  content: text === undefined ? [] : [{ type: "text", text, citations: null }],
});

function cannedChecks() {
  console.log("Canned model replies");

  const mixed = toAskResponse(
    reply(
      "end_turn",
      "Most households rent [census:06037701801], and a reviewer drives across town to do laundry " +
        "[review:sample-ocean-kitchen:0][census:06037701801]. Rents are high [census:99999999999]. " +
        "The Promenade is close [wikipedia:1080546, osm:node/1] [`osm:node/9000000003`][osm:node/9000000003]. " +
        "See [2] and [sic] and [Third Street Promenade](https://en.wikipedia.org/wiki/Third_Street_Promenade).",
    ),
    docs,
  );
  check(
    mixed.answer ===
      "Most households rent [1], and a reviewer drives across town to do laundry [2][1]. Rents are high. " +
        "The Promenade is close [3] [4]. " +
        "See and [sic] and [Third Street Promenade](https://en.wikipedia.org/wiki/Third_Street_Promenade).",
    "ids become [n], made-up ids and bare numbers are dropped, other brackets stay",
  );
  check(
    mixed.citations.map((c) => c.id).join(" ") ===
      "census:06037701801 review:sample-ocean-kitchen:0 wikipedia:1080546 osm:node/9000000003",
    "citations are numbered in order of first use",
  );
  checkCitations(mixed, "mixed");

  const uncovered = toAskResponse(reply("end_turn", "The documents don't include commercial rents."), docs);
  check(
    uncovered.answer === "The documents don't include commercial rents." && uncovered.citations.length === 0,
    "an answer without citations passes through",
  );

  const refused = toAskResponse(reply("refusal"), docs);
  check(refused.answer === REFUSAL_ANSWER && refused.citations.length === 0, "a refusal gets the fixed answer");

  const cut = toAskResponse(
    reply("max_tokens", "Laundry is missing [census:06037701801] and families want more [review:sample-corner-bo"),
    docs,
  );
  check(
    cut.answer === "Laundry is missing [1] and families want more …" && cut.citations.length === 1,
    "a max_tokens cutoff keeps the text and drops the half-written citation",
  );

  let threw = false;
  try {
    toAskResponse(reply("end_turn"), docs);
  } catch {
    threw = true;
  }
  check(threw, "an empty reply throws, so the route returns 502");

  const history: ChatTurn[] = [];
  for (let i = 1; i <= 6; i++) {
    history.push({ role: "user", content: `Question ${i}?` });
    history.push({ role: "assistant", content: `Answer ${i} [1], with more detail [2].` });
  }
  history.push({ role: "user", content: "Unanswered question?" });
  history.push({ role: "user", content: "What about childcare?" });
  const messages = buildMessages({ question: "What about childcare?", docs, history });
  const [first, ...rest] = messages;
  check(
    first.role === "user" &&
      first.content[0].cache_control?.type === "ephemeral" &&
      docs.every((doc) => first.content[0].text.includes(JSON.stringify(doc.id))),
    "the docs come first, with every id, behind a cache breakpoint",
  );
  check(
    messages.every((m, i) => i === 0 || m.role !== messages[i - 1].role),
    "roles alternate (same-role turns are merged)",
  );
  const sentTurns = [first.content.slice(1), ...rest.map((m) => m.content)].flat();
  check(sentTurns.length === 9, `only the last 8 history turns are sent, plus the question (sent ${sentTurns.length})`);
  check(
    rest.every((m) => m.role === "user" || m.content.every((b) => !/\[\d+\]/.test(b.text))),
    "earlier answers lose their [n] markers",
  );
  const lastBlocks = messages[messages.length - 1].content;
  check(
    messages[messages.length - 1].role === "user" &&
      lastBlocks[lastBlocks.length - 1].text === "What about childcare?" &&
      sentTurns.filter((b) => b.text === "What about childcare?").length === 1,
    "the question is last and not repeated",
  );
}

async function liveChecks() {
  console.log("\nLive questions to Claude");
  const ask = async (question: string, history?: ChatTurn[]) => {
    const started = Date.now();
    const response = await answerQuestion({ question, docs, history });
    console.log(`\nQ: ${question}\nA: ${response.answer}`);
    for (const [i, c] of response.citations.entries()) console.log(`   [${i + 1}] ${c.id}  ${c.title}`);
    console.log(`   (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    return response;
  };

  const laundromat = await ask("Would a laundromat do well here?");
  checkCitations(laundromat, "laundromat");
  check(laundromat.citations.length > 0, "laundromat: the answer cites its evidence");

  const history: ChatTurn[] = [
    { role: "user", content: "Would a laundromat do well here?" },
    { role: "assistant", content: laundromat.answer },
  ];
  const followUp = await ask("What about families with young kids?", history);
  checkCitations(followUp, "follow-up");
  check(followUp.citations.length > 0, "follow-up: the answer cites its evidence");

  const uncovered = await ask("What's the average commercial rent per square foot on Third Street?");
  checkCitations(uncovered, "uncovered");
  check(
    /\b(no|not|don't|doesn't|do not|does not|isn't|aren't|can't|cannot|without)\b/i.test(uncovered.answer),
    "uncovered: the answer says the docs don't cover it",
  );
}

async function main() {
  cannedChecks();
  if (process.env.ANTHROPIC_API_KEY) await liveChecks();
  else console.log("\nANTHROPIC_API_KEY isn't set, so the live questions were skipped.");
  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
