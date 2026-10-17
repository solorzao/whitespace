import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapRecords,
  readReports,
  saveReports,
  safeURL,
  isAnalysis,
  requestJSON,
} from "../src/components/explorer/data";
import { mockAnalysis } from "../src/lib/mock";
import { parsePoint } from "../src/lib/point";
import type { Report } from "../src/components/explorer/types";

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
  saveReports(
    {
      setItem: (_, value) => {
        stored = value;
      },
    },
    Array.from({ length: 10 }, (_, i) => ({ ...report, id: `${i}` })),
  );
  assert.equal(JSON.parse(stored).length, 6);
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
