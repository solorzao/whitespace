import { test } from "node:test";
import assert from "node:assert/strict";
import { isAnalysis } from "../src/components/explorer/data";
import { NO_DOCS_ANSWER, REFUSAL_ANSWER } from "../src/lib/ask/answer";
import { DEMO_AREAS, findDemoArea } from "../src/lib/ingest/demo-areas";
import { SUGGESTIONS, SUGGESTION_PLACES } from "../src/lib/suggestions";
import { savedThread } from "../src/lib/suggestions/saved";

test("suggestions have unique ids and questions, at listed places", () => {
  assert.equal(new Set(SUGGESTIONS.map((s) => s.id)).size, SUGGESTIONS.length);
  assert.equal(new Set(SUGGESTIONS.map((s) => s.question)).size, SUGGESTIONS.length);
  for (const s of SUGGESTIONS) assert(SUGGESTION_PLACES.includes(s.place), `${s.id}: unlisted place`);
  // A place within snapping distance of a demo area would be shown that area's data on the map.
  for (const place of SUGGESTION_PLACES) {
    const demo = findDemoArea(place.center);
    assert(!demo || demo.slug === place.slug, `${place.slug} is inside ${demo?.slug}`);
  }
  assert(DEMO_AREAS.every((area) => SUGGESTION_PLACES.some((p) => p.slug === area.slug)));
});

test("every suggestion has a saved thread that answers its question from the place's docs", async () => {
  for (const s of SUGGESTIONS) {
    const thread = await savedThread(s.id);
    assert(thread, `${s.id}: no saved thread (run scripts/save-suggestions.ts)`);
    assert(isAnalysis(thread.analysis), `${s.id}: incomplete analysis`);
    assert.equal(thread.analysis.concepts.length, 3, `${s.id}: expected 3 concepts`);
    assert.equal(thread.name, s.place.name);
    assert.deepEqual(
      thread.conversation.map((turn) => turn.question),
      [s.question],
    );
    const { answer, citations } = thread.conversation[0].response;
    assert(answer && answer !== NO_DOCS_ANSWER && answer !== REFUSAL_ANSWER, `${s.id}: no real answer`);
    assert(citations.length > 0, `${s.id}: no citations`);
    const ids = new Set(thread.analysis.docs.map((doc) => doc.id));
    assert(citations.every((c) => ids.has(c.id)), `${s.id}: a citation isn't in the docs`);
    const markers = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    assert(markers.every((n) => n >= 1 && n <= citations.length), `${s.id}: a marker has no citation`);
  }
});

test("a reworded or unknown suggestion has no saved thread", async () => {
  assert.equal(await savedThread("no-such-suggestion"), null);
});
