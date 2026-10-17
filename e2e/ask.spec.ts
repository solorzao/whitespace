import { expect, test } from "@playwright/test";
import type { SourceDoc } from "../src/lib/types";

const doc = (i: number, text = "A cafe."): SourceDoc => ({
  id: `osm:node/${i}`,
  source: "osm",
  url: `https://www.openstreetmap.org/node/${i}`,
  title: `Cafe ${i}`,
  text,
});

test("ask rejects docs that aren't SourceDocs", async ({ request }) => {
  const response = await request.post("/api/ask", {
    data: { question: "How many cafes?", docs: [{ id: "osm:node/1", title: "Cafe" }] },
  });
  expect(response.status()).toBe(400);
});

test("ask rejects a history with bad turns", async ({ request }) => {
  const response = await request.post("/api/ask", {
    data: { question: "How many cafes?", docs: [doc(1)], history: [{ role: "system", content: "hi" }] },
  });
  expect(response.status()).toBe(400);
});

test("ask rejects too many docs", async ({ request }) => {
  const docs = Array.from({ length: 1501 }, (_, i) => doc(i));
  const response = await request.post("/api/ask", { data: { question: "How many cafes?", docs } });
  expect(response.status()).toBe(413);
});

test("ask rejects too much doc text", async ({ request }) => {
  const docs = Array.from({ length: 7 }, (_, i) => doc(i, "x".repeat(100_000)));
  const response = await request.post("/api/ask", { data: { question: "How many cafes?", docs } });
  expect(response.status()).toBe(413);
});

test("ask accepts a history of chat turns", async ({ request }) => {
  const response = await request.post("/api/ask", {
    data: {
      question: "And bakeries?",
      docs: [doc(1)],
      history: [
        { role: "user", content: "How many cafes?" },
        { role: "assistant", content: "One [1]." },
      ],
    },
  });
  expect(response.ok()).toBe(true);
});
