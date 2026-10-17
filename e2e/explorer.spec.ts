import { test, expect, type Page } from "@playwright/test";
import { DEMO_AREAS } from "../src/lib/ingest/demo-areas";
import { SUGGESTIONS } from "../src/lib/suggestions";

async function selectNeighborhood(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "SCROLL TO DISCOVER" }).click();
  await page
    .getByRole("button", { name: "Santa Monica ↗", exact: true })
    .click();
  await expect(page.getByText("source documents shown")).toBeVisible();
}
async function research(page: Page) {
  await selectNeighborhood(page);
  await page
    .getByRole("button", { name: "Find business opportunities ↗" })
    .click();
  await expect(
    page.getByRole("region", { name: "Neighborhood research report" }),
  ).toBeVisible();
}

test("neighborhood evidence, map filters, real API analysis and cited follow-up work together", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await selectNeighborhood(page);
  await expect(page.getByText("800 m radius", { exact: true })).toBeVisible();
  for (const name of ["Businesses", "Places", "Reviews", "Census", "Knowledge"])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(
    page.getByText("All map sources are off.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Businesses", exact: true }).click();
  await page
    .getByRole("button", { name: "Find business opportunities ↗" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Business opportunities", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#report-conversation h2")).toHaveText("Summary");
  await expect(page.locator(".summary-opportunity")).toBeVisible();
  await expect(page.locator(".report-details")).toHaveCount(5);
  await expect(page.locator(".report-details[open]")).toHaveCount(0);
  for (const selector of [
    ".report-metrics",
    ".opportunity-card",
    ".table-scroll",
    ".business-list",
    ".source-documents",
  ])
    await expect(page.locator(selector).first()).toBeHidden();
  await page.locator("#report-overview > summary").click();
  await expect(
    page.getByText("Test mode is enabled.", { exact: false }),
  ).toBeVisible();
  await page.locator("#report-opportunities > summary").click();
  const card = page.locator(".opportunity-card").first();
  await expect(card.locator(".gap-type")).toHaveText("Poorly served");
  await expect(card.locator(".card-signals li").first()).toContainText(
    "Based on 2 census tracts",
  );
  await page.locator("#report-businesses > summary").click();
  const summary = page.locator(".business-list .review-summary").first();
  await expect(summary).toContainText("Known for:");
  await expect(summary.getByRole("link").first()).toHaveAttribute(
    "href",
    /^https:\/\//,
  );
  await page
    .getByLabel("Follow-up question", { exact: true })
    .fill("Would a laundromat do well here?");
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/api/ask"),
  );
  await page
    .getByRole("button", { name: "Ask question ↗", exact: true })
    .click();
  expect((await request).postDataJSON().docs.length).toBeGreaterThan(0);
  await expect(page.locator(".cited-answer")).toContainText(
    "This is a sample answer",
  );
  await expect(page.locator(".cited-answer a").first()).toHaveAttribute(
    "href",
    /^https:\/\//,
  );
  expect(errors).toEqual([]);
});

test("reports and conversations survive refresh and can reopen from history", async ({
  page,
}) => {
  await research(page);
  const url = page.url();
  await page.locator("#report-gaps > summary").click();
  await expect(page.locator("#report-gaps table")).toBeVisible();
  await page.reload();
  await expect(page.locator(".report-details[open]")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Business opportunities", exact: true }),
  ).toBeVisible();
  await page.locator("#report-sources > summary").click();
  await expect(page.getByLabel("Find a source", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Back to globe", exact: false })
    .click();
  await expect(
    page.getByRole("region", { name: "Neighborhood research report" }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Open query history", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "What businesses is this neighborhood missing?",
      exact: false,
    })
    .click();
  await expect(page).toHaveURL(url);
  await expect(page.locator(".report-details[open]")).toHaveCount(0);
});

test("keyboard search submits a custom question in the chosen neighborhood", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Search questions and places", exact: true })
    .click();
  await page
    .getByLabel("Location for your question")
    .selectOption("lower-manhattan");
  await page
    .getByRole("combobox", { name: "Search questions and places" })
    .fill("Which business should I open here?");
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/api/analyze"),
  );
  await page
    .getByRole("combobox", { name: "Search questions and places" })
    .press("Enter");
  expect((await request).postDataJSON()).toEqual({
    lat: 40.7075,
    lng: -74.0113,
  });
  await expect(
    page.getByRole("heading", { name: "Lower Manhattan", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cited-answer")).toContainText(
    "Which business should I open here?",
  );
  const summaryBox = await page.locator("#report-conversation").boundingBox();
  const overviewBox = await page.locator("#report-overview").boundingBox();
  expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(overviewBox!.y);
  await expect(page.locator(".report-details[open]")).toHaveCount(0);

  await page
    .getByLabel("Follow-up question", { exact: true })
    .fill("What should I test first?");
  const followupRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/ask"),
  );
  await page
    .getByRole("button", { name: "Ask question ↗", exact: true })
    .click();
  expect((await followupRequest).postDataJSON().history).toHaveLength(2);
  await expect(page.locator("#report-conversation .cited-answer")).toContainText(
    "What should I test first?",
  );
  await expect(page.locator("#report-history .cited-answer")).toBeHidden();
  await page.locator("#report-history > summary").click();
  await expect(page.locator("#report-history .cited-answer")).toContainText(
    "Which business should I open here?",
  );
});

test("cancellation discards a late analysis without saving a thread", async ({
  page,
}) => {
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/analyze", async (route) => {
    await paused;
    await route
      .fulfill({ status: 503, json: { error: "late response" } })
      .catch(() => {});
  });
  await selectNeighborhood(page);
  await page
    .getByRole("button", { name: "Find business opportunities ↗" })
    .click();
  await page
    .getByRole("button", { name: "Cancel research", exact: true })
    .click();
  release();
  await expect(
    page.getByRole("complementary", { name: "Research in progress" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open query history", exact: true })
    .click();
  await expect(
    page.getByText("Your completed neighborhood research will appear here."),
  ).toBeVisible();
});

test("API failures show an actionable retry and never substitute a report", async ({
  page,
}) => {
  await page.route("**/api/analyze", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Business sources are unavailable. Please try again." },
    }),
  );
  await selectNeighborhood(page);
  await page
    .getByRole("button", { name: "Find business opportunities ↗" })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Business sources are unavailable." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find business opportunities ↗" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Neighborhood research report" }),
  ).toHaveCount(0);
});

test("mobile region controls and report fit without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await selectNeighborhood(page);
  const card = await page.locator("#region-card").boundingBox();
  const dock = await page.locator(".source-dock").boundingBox();
  expect(card).not.toBeNull();
  expect(dock).not.toBeNull();
  expect(card!.x).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width).toBeLessThanOrEqual(390);
  expect(card!.y + card!.height).toBeLessThan(dock!.y);
  await page
    .getByRole("button", { name: "Find business opportunities ↗" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Business opportunities", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator("#research-results")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/whitespace-production-mobile.png" });
});

test("search and research remain usable if WebGL is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type.startsWith("webgl")) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Search questions and places", exact: true })
    .click();
  await page
    .getByRole("option", { name: SUGGESTIONS[0].question, exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "Business opportunities", exact: true }),
  ).toBeVisible();
});

test("a suggestion opens its saved thread at once, without analyzing or asking", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname === "/api/analyze" || pathname === "/api/ask")
      calls.push(pathname);
  });
  const suggestion =
    SUGGESTIONS.find(
      (s) => !DEMO_AREAS.some((area) => area.slug === s.place.slug),
    ) ?? SUGGESTIONS[0];
  await page.goto("/");
  await page
    .getByRole("button", { name: "Search questions and places", exact: true })
    .click();
  await expect(page.getByRole("option")).toHaveCount(
    SUGGESTIONS.length + DEMO_AREAS.length,
  );
  await page
    .getByRole("option", { name: suggestion.question, exact: false })
    .click();
  const report = page.getByRole("region", {
    name: "Neighborhood research report",
  });
  await expect(
    report.getByRole("heading", { name: suggestion.place.name, exact: true }),
  ).toBeVisible();
  await expect(report.locator(".report-question")).toHaveText(
    suggestion.question,
  );
  // The saved answer is the thread's summary.
  await expect(
    report.locator("#report-conversation .cited-answer a").first(),
  ).toHaveAttribute("href", /^https:\/\//);
  expect(calls).toEqual([]);

  // Typing filters the suggestions, and opening one again reopens the same thread.
  await page.getByRole("button", { name: "Back to globe", exact: false }).click();
  await page
    .getByRole("button", { name: "Search questions and places", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Search questions and places" })
    .fill(suggestion.place.name);
  await page
    .getByRole("option", { name: suggestion.question, exact: false })
    .click();
  await expect(report.locator(".report-question")).toHaveText(
    suggestion.question,
  );
  await page
    .getByRole("button", { name: "Back to globe", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Open query history", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: suggestion.question, exact: false }),
  ).toHaveCount(1);
  expect(calls).toEqual([]);
});
