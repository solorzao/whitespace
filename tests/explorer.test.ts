import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GAP_LABELS,
  mapRecords,
  readReports,
  saveReports,
  safeURL,
  isAnalysis,
  requestJSON,
} from "../src/components/explorer/data";
import { ResearchReport } from "../src/components/explorer/report";
import { mockAnalysis } from "../src/lib/mock";
import { parsePoint } from "../src/lib/point";
import type { Analysis, Report } from "../src/components/explorer/types";

const analysis = mockAnalysis({ lat: 34.0195, lng: -118.4912 });
const report: Report = {
  id: "test-report",
  name: "Santa Monica",
  question: "What is missing?",
  createdAt: "2026-10-17T12:00:00Z",
  analysis,
  conversation: [],
};

test("map records use only source documents with actual geographic coordinates", () => {
  const records = mapRecords(analysis.docs);
  const ids = new Set(analysis.docs.map((doc) => doc.id));
  assert(records.length > 0);
  assert(
    records.every(
      (record) =>
        ids.has(record.id) &&
        Number.isFinite(record.lon) &&
        Number.isFinite(record.lat),
    ),
  );
  assert.deepEqual(
    mapRecords([
      {
        id: "no-point",
        source: "census",
        title: "No point",
        text: "",
        url: "",
      },
    ]),
    [],
  );
});

test("history restores completed evidence and rejects corrupt or incomplete reports", () => {
  let stored = "";
  const storage = {
    getItem: () => stored,
    setItem: (_: string, value: string) => {
      stored = value;
    },
  };
  assert(saveReports(storage, [report]));
  assert.deepEqual(readReports(storage), [report]);
  stored = "{invalid";
  assert.deepEqual(readReports(storage), []);
  stored = JSON.stringify([{ ...report, analysis: { docs: [] } }]);
  assert.deepEqual(readReports(storage), []);
  stored = JSON.stringify([
    { ...report, conversation: [{ question: "test", response: null }] },
  ]);
  assert.deepEqual(readReports(storage), []);
  assert.equal(
    saveReports(
      {
        setItem: () => {
          throw Error("quota");
        },
      },
      [report],
    ),
    false,
  );
});

test("history keeps a bounded number of recent reports and handles unavailable storage", () => {
  let stored = "";
  const storage: Pick<Storage, "setItem"> = {
    setItem: (_, value) => {
      stored = value;
    },
  };
  // Without its source documents a report is small, so only the count limit applies.
  const small: Report = { ...report, analysis: { ...analysis, docs: [] } };
  saveReports(
    storage,
    Array.from({ length: 10 }, (_, i) => ({ ...small, id: `${i}` })),
  );
  assert.equal(JSON.parse(stored).length, 6);
  // The mock is a saved demo analysis of about 0.5 MB, so full reports stop at the size limit first.
  saveReports(
    storage,
    Array.from({ length: 10 }, (_, i) => ({ ...report, id: `${i}` })),
  );
  const kept: unknown[] = JSON.parse(stored);
  assert(kept.length >= 1 && kept.length < 6);
  assert(stored.length <= 1_500_000);
  assert.deepEqual(
    readReports({
      getItem: () => {
        throw Error("blocked");
      },
    }),
    [],
  );
});

test("source links cannot run script or use local protocols", () => {
  assert.equal(safeURL("javascript:alert(1)"), undefined);
  assert.equal(safeURL("data:text/html,test"), undefined);
  assert.equal(
    safeURL("https://example.com/source"),
    "https://example.com/source",
  );
});

test("point parsing and analysis validation reject non-finite and out-of-range data", () => {
  for (const point of [
    null,
    { lat: "34", lng: 0 },
    { lat: NaN, lng: 0 },
    { lat: 0, lng: 181 },
    { lat: 91, lng: 0 },
  ])
    assert.equal(parsePoint(point), null);
  assert.deepEqual(parsePoint({ lat: 34, lng: -118 }), { lat: 34, lng: -118 });
  assert(isAnalysis(analysis));
  assert(!isAnalysis({ ...analysis, gaps: [null] }));
});

test("cancelled requests never reach the API", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(requestJSON("/api/analyze", {}, controller.signal));
});

// A report saved before /api/analyze returned gap types, card signals and review summaries.
function olderReport(): Report {
  const older: Analysis = structuredClone(analysis);
  delete older.signals;
  delete older.summaries;
  for (const concept of older.concepts) delete concept.gapType;
  return { ...report, analysis: older };
}
const render = (value: Report) =>
  renderToStaticMarkup(
    createElement(ResearchReport, {
      report: value,
      asking: false,
      chatError: "",
      onAsk: async () => false,
      onLocate: () => {},
    }),
  );
const escaped = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");

test("analysis validation checks gap types, card signals and review summaries, and allows reports without them", () => {
  assert(analysis.concepts.every((c) => c.gapType));
  assert(analysis.signals.length && analysis.summaries.length);
  assert(isAnalysis(olderReport().analysis));
  let stored = "";
  const storage = {
    getItem: () => stored,
    setItem: (_: string, value: string) => {
      stored = value;
    },
  };
  saveReports(storage, [olderReport()]);
  assert.deepEqual(readReports(storage), [olderReport()]);

  const [concept, ...concepts] = analysis.concepts;
  const [summary, ...summaries] = analysis.summaries;
  for (const broken of [
    { concepts: [{ ...concept, gapType: "crowded" }, ...concepts] },
    { signals: [{ category: "pharmacy", lines: [1] }] },
    { signals: "Based on 2 census tracts." },
    { summaries: [{ ...summary, knownFor: 5 }, ...summaries] },
    { summaries: [{ ...summary, evidence: null }, ...summaries] },
  ])
    assert(!isAnalysis({ ...analysis, ...broken }));
});

test("concept cards show the gap type and signal lines, and businesses show review summaries", () => {
  const html = render(report);
  assert.deepEqual(
    html.match(/<span class="gap-type">[^<]*<\/span>/g),
    analysis.concepts.map(
      (c) => `<span class="gap-type">${GAP_LABELS[c.gapType]}</span>`,
    ),
  );
  assert(html.includes(`<span class="gap-type">Poorly served</span>`));
  for (const line of analysis.signals.flatMap((s) => s.lines))
    assert(html.includes(`<li>${escaped(line)}</li>`), line);

  const ids = new Set(analysis.businesses.map((b) => b.id));
  const onMap = analysis.summaries.filter((s) => ids.has(s.businessId));
  assert(onMap.length > 0);
  for (const s of onMap) {
    if (s.knownFor)
      assert(html.includes(`<strong>Known for:</strong> ${escaped(s.knownFor)}`));
    if (s.complaints)
      assert(html.includes(`<strong>Complaints:</strong> ${escaped(s.complaints)}`));
  }
  const review = analysis.docs.find((d) => d.id === onMap[0].evidence[0])!;
  assert(html.includes(`href="${escaped(safeURL(review.url)!)}"`));
  // Businesses with summaries come first in the list.
  const first = analysis.businesses.find((b) =>
    onMap.some((s) => s.businessId === b.id),
  )!;
  assert.notEqual(first, analysis.businesses[0]);
  const list = html.slice(html.indexOf('<ul class="business-list">'));
  assert(list.indexOf(escaped(first.name)) < list.indexOf("</li>"));

  const older = render(olderReport());
  for (const name of ["gap-type", "card-signals", "review-summary"])
    assert(!older.includes(name), name);
  assert(older.includes("Business opportunities"));
});
