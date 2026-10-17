import { expect, test } from "@playwright/test";
import type { AnalyzeResponse, AskResponse } from "../src/lib/types";

const SANTA_MONICA = { lat: 34.0195, lng: -118.4912 };

test("analyze returns evidence and businesses that exist in docs", async ({ request }) => {
  const response = await request.post("/api/analyze", { data: SANTA_MONICA });
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as AnalyzeResponse;
  const ids = new Set(body.docs.map((d) => d.id));
  expect(body.concepts).toHaveLength(3);
  for (const concept of body.concepts) {
    for (const id of concept.evidence) expect(ids).toContain(id);
  }
  for (const business of body.businesses) expect(ids).toContain(business.id);
});

test("analyze rejects a request without a point", async ({ request }) => {
  const response = await request.post("/api/analyze", { data: { lat: "north" } });
  expect(response.status()).toBe(400);
});

test("ask cites only docs it was given", async ({ request }) => {
  const analysis = (await (
    await request.post("/api/analyze", { data: SANTA_MONICA })
  ).json()) as AnalyzeResponse;

  const response = await request.post("/api/ask", {
    data: { question: "Would a laundromat do well here?", docs: analysis.docs },
  });
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as AskResponse;
  const ids = new Set(analysis.docs.map((d) => d.id));
  expect(body.answer.length).toBeGreaterThan(0);
  for (const citation of body.citations) expect(ids).toContain(citation.id);
});

test("ask rejects an empty question", async ({ request }) => {
  const response = await request.post("/api/ask", { data: { question: " ", docs: [] } });
  expect(response.status()).toBe(400);
});
