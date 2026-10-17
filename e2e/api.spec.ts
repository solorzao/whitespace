import { expect, test } from "@playwright/test";
import type { AnalyzeResponse, AskResponse } from "../src/lib/types";
import type { Report } from "../src/components/explorer/types";
import { SUGGESTIONS } from "../src/lib/suggestions";

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

test('area index contains collected geographic records, without generated global pins', async ({ request }) => {
  const response = await request.get('/api/area');
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.areas.map((area: { slug: string }) => area.slug)).toEqual(['santa-monica', 'lower-manhattan']);
  expect(body.records.length).toBeGreaterThan(0);
  for (const record of body.records) {
    expect(record.id).toMatch(/^(osm|places|review|census|wikipedia):/);
    expect(Number.isFinite(record.lat) && Number.isFinite(record.lon)).toBe(true);
  }
});

test('area selection rejects invalid coordinates and labels explicitly enabled mocks', async ({ request }) => {
  expect((await request.post('/api/area', { data: { lat: 91, lng: 0 } })).status()).toBe(400);
  const response = await request.post('/api/area', { data: SANTA_MONICA });
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ radiusM: 800, from: 'mock', mock: true });
});

test("every search suggestion serves its saved thread, and an unknown one is not found", async ({ request }) => {
  for (const suggestion of SUGGESTIONS) {
    const response = await request.get(`/api/suggestions/${suggestion.id}`);
    expect(response.ok(), suggestion.id).toBe(true);
    const body = (await response.json()) as Report;
    expect(body).toMatchObject({ name: suggestion.place.name, question: suggestion.question });
    expect(body.analysis.concepts).toHaveLength(3);
    const ids = new Set(body.analysis.docs.map((d) => d.id));
    const [turn] = body.conversation;
    expect(turn.question).toBe(suggestion.question);
    for (const citation of turn.response.citations) expect(ids).toContain(citation.id);
  }
  expect((await request.get("/api/suggestions/no-such-suggestion")).status()).toBe(404);
});
