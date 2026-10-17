# Whitespace

A globe for finding the businesses a neighborhood is missing. The Next.js app connects the globe interface to the project's ingestion, gap scoring, competitor profiles, concept generation, and cited follow-up answers.

## Develop

Use Node.js 22.13+ (CI uses Node 24).

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Set `ANTHROPIC_API_KEY` for AI concepts and answers. API keys stay on the server. Follow `.env.example` for optional Census and Google Places configuration; `PLACES_LIVE=1` explicitly enables billed live Places calls. The saved Santa Monica and Lower Manhattan collections work without live Places calls. Other selected points use the existing live ingestion adapters.

For an explicitly labeled, offline test mode, set `WHITESPACE_MOCK=1`. Production uses the real APIs when this variable is unset. Missing providers or failed model calls produce visible partial-result/error states; the interface does not silently replace them with sample reports.

## Interface and data flow

- The horizon, globe, source pins, search dialog, research view, and browser-local thread history preserve the completed mockup's design.
- `GET /api/area` returns the saved neighborhood index and actual source coordinates. No generated global corpus is loaded.
- Selecting a point calls `POST /api/area` to collect source evidence without a model call. Pins within 300 m of a saved neighborhood center follow the backend's snapping behavior.
- Research calls `POST /api/analyze` with `{lat, lng}`. The selection circle and UI use the backend's fixed 800 m neighborhood radius. Wikipedia context and the 2 km competitor study may cover a wider area.
- Custom questions and follow-ups call `POST /api/ask` with the analysis documents and recent chat turns. Inline citations and evidence links resolve to the returned source documents.
- Source controls filter map pins and the selection's document counts. Analysis uses all available sources. Counts describe documents, which may include multiple records about the same business.
- Reports show saved/live provenance, unavailable sources or analysis steps, category gaps, business listings, optional competitor profiles, and evidence. Gap scores are demographic-adjusted scores, not probabilities.
- Completed reports and conversations are retained in browser storage (up to six, subject to a 1.5-million-character budget). Corrupt records are ignored. Blocked/full storage leaves the active report usable in memory. Report URLs reopen saved browser-local reports after refresh.
- Cancelling a request prevents late results from changing the interface or entering history. Server-side provider work remains subject to the existing backend deadlines.

The globe loads in a separate client chunk and releases its WebGL resources on unmount. Search and research remain usable when WebGL cannot initialize. Map download concurrency, cancellation, cached imagery coverage, and reduced-motion behavior are preserved.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright uses explicitly enabled server mocks, so automated tests do not call billed providers. Existing API contract tests run alongside interface coverage for source selection/filtering, research, citations, follow-ups, history/refresh, custom search scopes, cancellation, failures, mobile geometry, and unavailable WebGL. The map unit tests cover geographic anchors, clustering, zoom, tile cancellation, and coverage. Production deployment requires the actual provider configuration and a live model check.

## Deploy

Deploy as a Next.js project, with this repository as the project root. `npm run build` creates the production app; `npm start` serves it. Existing Next.js output tracing includes `data/demo/**/*.json` with API routes. Configure server API keys in the deployment environment and leave `WHITESPACE_MOCK` unset.

Earth surface textures are bundled in `public/textures` from the [Three.js planet examples](https://github.com/mrdoob/three.js/tree/master/examples/textures/planets). Close views load Esri World Imagery and World Basemap vector tiles with visible attribution. `NEXT_PUBLIC_IMAGERY_TILE_URL` optionally overrides the imagery template (`{z}`, `{x}`, `{y}`); it is a public URL and must not contain secret credentials. Map labels and the UI use DM Sans via Next.js font loading.

The shared data/API contract remains in `src/lib/types.ts` and `PROJECT_PLAN.md`. The original mockup is preserved on the local `init-mockup` branch.
