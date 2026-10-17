"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type { AskResponse, SourceDoc } from "@/lib/types";
import {
  AREA_RADIUS_M,
  DEMO_AREAS,
  findDemoArea,
} from "@/lib/ingest/demo-areas";
import { SUGGESTIONS, threadId, type Suggestion } from "@/lib/suggestions";
import { types } from "./map/sources";
import { sourcePaths } from "./map/icons";
import type { Globe } from "./map/globe";
import {
  isAnalysis,
  mapRecords,
  readReports,
  requestJSON,
  saveReports,
} from "./data";
import type {
  Analysis,
  AreaIndex,
  AreaResult,
  MapPoint,
  MapRecord,
  Report,
} from "./types";
import { ResearchReport } from "./report";
import "./explorer.css";

const RADIUS_KM = AREA_RADIUS_M / 1000;
const DEFAULT_QUESTION = "What businesses is this neighborhood missing?";
const coordinate = (point: MapPoint) =>
  `${point.lat.toFixed(4)}°, ${point.lon.toFixed(4)}°`;
const message = (error: unknown) =>
  error instanceof Error
    ? error.name === "TimeoutError"
      ? "This request took too long. Please try again."
      : error.message
    : "Something went wrong. Please try again.";

type Selection = {
  point: MapPoint;
  status: "loading" | "ready" | "error";
  area?: AreaResult;
  error?: string;
};
type Run = { name: string; question: string; step: string; collapsed: boolean };
type SearchItem = {
  kind: "question" | "suggestion" | "place";
  title: string;
  description: string;
  point: MapPoint | null;
  suggestion?: Suggestion;
};
const placeItem = (area: (typeof DEMO_AREAS)[number]): SearchItem => ({
  kind: "place",
  title: area.name,
  description: "Explore collected neighborhood sources",
  point: { lat: area.center.lat, lon: area.center.lng, name: area.name },
});
const suggestionItem = (suggestion: Suggestion): SearchItem => ({
  kind: "suggestion",
  title: suggestion.question,
  description: `${suggestion.place.name} · Saved research`,
  point: null,
  suggestion,
});
const isReport = (value: unknown): value is Report => {
  const report = value as Report | null;
  return (
    !!report &&
    typeof report.id === "string" &&
    typeof report.name === "string" &&
    typeof report.question === "string" &&
    typeof report.createdAt === "string" &&
    isAnalysis(report.analysis) &&
    Array.isArray(report.conversation)
  );
};

function Icon({ id }: { id: string }) {
  return (
    <svg className="source-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fillRule="evenodd" d={sourcePaths[id]} />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

export default function Explorer() {
  const spaceRef = useRef<HTMLDivElement>(null);
  const signalsRef = useRef<HTMLCanvasElement>(null);
  const experienceRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLElement>(null);
  const cueRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const threadsRef = useRef<HTMLDialogElement>(null);
  const outputRef = useRef<HTMLElement>(null);
  const scaleRef = useRef<HTMLSpanElement>(null);
  const globeRef = useRef<Globe | null>(null);
  const recordsRef = useRef<MapRecord[]>([]);
  const regionRequest = useRef<AbortController | null>(null);
  const researchRequest = useRef<AbortController | null>(null);
  const chatRequest = useRef<AbortController | null>(null);
  const activeReportRef = useRef<string | null>(null);
  const reportsRef = useRef<Report[]>([]);
  const progressRef = useRef(0);
  const collapsedRef = useRef(false);
  const reportRouteAdded = useRef(false);
  const suggestionThreads = useRef(new Map<string, Promise<Report>>());
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [imagery, setImagery] = useState(false);
  const [reference, setReference] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [index, setIndex] = useState<AreaIndex | null>(null);
  const [activeSources, setActiveSources] = useState(
    new Set(types.map((_, i) => i)),
  );
  const [question, setQuestion] = useState("");
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState(DEMO_AREAS[0].slug);
  const [activeResult, setActiveResult] = useState(0);
  const [notice, setNotice] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [threadFilter, setThreadFilter] = useState("");
  const [asking, setAsking] = useState(false);
  const [chatError, setChatError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  const persist = useCallback((next: Report[]) => {
    reportsRef.current = next;
    setReports(next);
    try {
      setStorageWarning(!saveReports(localStorage, next));
    } catch {
      setStorageWarning(true);
    }
  }, []);
  // A suggestion's saved thread is a static file; hovering a suggestion starts loading it, so a click
  // usually finds it loaded. A failed load is forgotten, so the next attempt retries.
  const loadSuggestion = useCallback((id: string) => {
    let pending = suggestionThreads.current.get(id);
    if (!pending) {
      pending = fetch(`/api/suggestions/${id}`).then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !isReport(body))
          throw new Error("This suggestion has no saved research.");
        return body;
      });
      pending.catch(() => suggestionThreads.current.delete(id));
      suggestionThreads.current.set(id, pending);
    }
    return pending;
  }, []);
  const enter = useCallback(() => {
    const maximum =
      (experienceRef.current?.offsetHeight || innerHeight) - innerHeight;
    window.scrollTo({ top: maximum, behavior: "instant" });
    progressRef.current = 1;
    globeRef.current?.setProgress(1);
  }, []);
  const closeRegion = useCallback(() => {
    regionRequest.current?.abort();
    setSelection(null);
    globeRef.current?.clearSelection();
  }, []);

  const selectRegion = useCallback(async (point: MapPoint, focus = false) => {
    regionRequest.current?.abort();
    const controller = new AbortController();
    regionRequest.current = controller;
    setNotice("");
    setQuestion("");
    setTooltip(null);
    const demo = findDemoArea({ lat: point.lat, lng: point.lon });
    const selected = demo
      ? {
          ...point,
          lat: demo.center.lat,
          lon: demo.center.lng,
          name: demo.name,
        }
      : {
          ...point,
          name: point.name || `Neighborhood at ${coordinate(point)}`,
        };
    setSelection({ point: selected, status: "loading" });
    if (focus || demo)
      globeRef.current?.focus(selected, {
        radiusKm: RADIUS_KM,
        selectPoint: false,
      });
    globeRef.current?.setRegionRadius(RADIUS_KM);
    try {
      const area = await requestJSON<AreaResult>(
        "/api/area",
        { lat: selected.lat, lng: selected.lon },
        controller.signal,
        40_000,
      );
      if (controller.signal.aborted) return;
      const actual = {
        ...selected,
        lat: area.center.lat,
        lon: area.center.lng,
      };
      globeRef.current?.setRecords([
        ...new Map(
          [...recordsRef.current, ...mapRecords(area.docs)].map((record) => [
            record.id,
            record,
          ]),
        ).values(),
      ]);
      setSelection({ point: actual, status: "ready", area });
    } catch (error) {
      if (!controller.signal.aborted)
        setSelection({
          point: selected,
          status: "error",
          error: message(error),
        });
    }
  }, []);
  const mapSelect = useEffectEvent((point: MapPoint) => {
    void selectRegion(point);
  });
  const mapMove = useEffectEvent(() => {
    closeRegion();
    setTooltip(null);
  });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let globe: Globe | undefined;
    import("./map/globe")
      .then(({ createGlobe }) => {
        if (disposed || !spaceRef.current || !signalsRef.current) return;
        return createGlobe(spaceRef.current, signalsRef.current, {
          select: (point) => mapSelect(point),
          move: () => mapMove(),
          hover: setTooltip,
          scale: (km) => {
            if (scaleRef.current)
              scaleRef.current.textContent =
                km >= 1
                  ? `${Math.round(km).toLocaleString()} km`
                  : `${Math.max(1, Math.round(km * 1000))} m`;
          },
          imagery: setImagery,
          reference: setReference,
        });
      })
      .then((value) => {
        if (!value) return;
        globe = value;
        if (disposed) {
          value.dispose();
          return;
        }
        globeRef.current = value;
        value.setRecords(recordsRef.current);
        value.setProgress(progressRef.current);
        setMapStatus("ready");
      })
      .catch((error) => {
        if (!disposed) {
          console.error("Globe could not load", error);
          setMapStatus("error");
        }
      });
    fetch("/api/area", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Could not load featured neighborhoods. Search and map selection still work.",
          );
        return response.json() as Promise<AreaIndex>;
      })
      .then((data) => {
        if (disposed) return;
        recordsRef.current = data.records;
        setIndex(data);
        globeRef.current?.setRecords(data.records);
      })
      .catch((error) => {
        if (!disposed) setNotice(message(error));
      });
    // Storage may be blocked or full; the active report remains usable in memory.
    Promise.resolve().then(() => {
      if (disposed) return;
      try {
        const restored = readReports(localStorage);
        reportsRef.current = restored;
        setReports(restored);
        if (location.hash.startsWith("#research/")) {
          const id = location.hash.slice("#research/".length);
          const saved = restored.find((item) => item.id === id);
          if (saved) {
            setReport(saved);
            activeReportRef.current = id;
            setReportOpen(true);
          } else
            history.replaceState(null, "", location.pathname + location.search);
        }
      } catch {
        setStorageWarning(true);
      }
    });
    return () => {
      disposed = true;
      controller.abort();
      regionRequest.current?.abort();
      researchRequest.current?.abort();
      chatRequest.current?.abort();
      globe?.dispose();
      globeRef.current = null;
    };
  }, []);

  useEffect(() => {
    function scrollProgress() {
      const maximum =
        (experienceRef.current?.offsetHeight || innerHeight) - innerHeight;
      const progress = Math.max(0, Math.min(1, scrollY / Math.max(1, maximum)));
      progressRef.current = progress;
      stageRef.current?.style.setProperty("--progress", String(progress));
      stageRef.current?.classList.toggle("exploring", progress > 0.75);
      if (heroRef.current) {
        heroRef.current.style.opacity = String(Math.max(0, 1 - progress * 3.7));
        heroRef.current.style.transform = `translateY(${-progress * 70}px)`;
        heroRef.current.setAttribute("aria-hidden", String(progress > 0.3));
      }
      if (controlsRef.current) {
        controlsRef.current.inert = progress <= 0.75;
        controlsRef.current.style.opacity = String(
          Math.max(0, Math.min(1, (progress - 0.65) / 0.3)),
        );
      }
      if (cueRef.current) {
        cueRef.current.style.opacity = String(Math.max(0, 1 - progress * 5));
        cueRef.current.style.pointerEvents = progress > 0.2 ? "none" : "auto";
        cueRef.current.tabIndex = progress > 0.2 ? -1 : 0;
      }
      globeRef.current?.setProgress(progress);
    }
    window.addEventListener("scroll", scrollProgress, { passive: true });
    window.addEventListener("resize", scrollProgress);
    scrollProgress();
    return () => {
      window.removeEventListener("scroll", scrollProgress);
      window.removeEventListener("resize", scrollProgress);
    };
  }, []);
  useEffect(() => {
    document.body.classList.toggle("ready", mapStatus === "ready");
    document.body.classList.toggle("local-view", imagery);
    document.body.classList.toggle("region-open", !!selection);
    document.body.classList.toggle("report-open", reportOpen);
    document.body.classList.toggle("research-running", !!run);
    globeRef.current?.setPaused(reportOpen);
    if (stageRef.current) stageRef.current.inert = reportOpen;
    if (reportOpen) outputRef.current?.focus({ preventScroll: true });
    return () => {
      for (const name of [
        "ready",
        "local-view",
        "region-open",
        "report-open",
        "research-running",
      ])
        document.body.classList.remove(name);
    };
  }, [mapStatus, imagery, selection, reportOpen, run]);

  const openReport = useCallback((item: Report) => {
    chatRequest.current?.abort();
    setAsking(false);
    setChatError("");
    activeReportRef.current = item.id;
    setReport(item);
    setReportOpen(true);
    dialogRef.current?.close();
    threadsRef.current?.close();
    if (location.hash !== `#research/${item.id}`) {
      history.pushState(null, "", `#research/${item.id}`);
      reportRouteAdded.current = true;
    }
  }, []);
  const collapseReport = useCallback(() => {
    chatRequest.current?.abort();
    setAsking(false);
    setChatError("");
    setReportOpen(false);
    if (reportRouteAdded.current) {
      history.back();
      reportRouteAdded.current = false;
    } else history.replaceState(null, "", location.pathname + location.search);
    enter();
    searchRef.current?.focus({ preventScroll: true });
  }, [enter]);
  useEffect(() => {
    const onHash = () => {
      const id = location.hash.startsWith("#research/")
        ? location.hash.slice("#research/".length)
        : "";
      const saved = reportsRef.current.find((item) => item.id === id);
      chatRequest.current?.abort();
      setAsking(false);
      setReportOpen(!!saved);
      if (saved) {
        activeReportRef.current = saved.id;
        setReport(saved);
      }
    };
    window.addEventListener("popstate", onHash);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("popstate", onHash);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  const cancelResearch = useCallback(() => {
    researchRequest.current?.abort();
    researchRequest.current = null;
    globeRef.current?.stopResearch();
    setRun(null);
  }, []);
  const openSearch = useCallback(() => {
    threadsRef.current?.close();
    setQuery("");
    setActiveResult(0);
    if (selection) setSearchScope("selected");
    dialogRef.current?.showModal();
    searchInputRef.current?.focus();
    // The first suggestion is highlighted, so Enter opens it.
    void loadSuggestion(SUGGESTIONS[0].id);
  }, [selection, loadSuggestion]);
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (event.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (dialogRef.current?.open) dialogRef.current.close();
      else openSearch();
      return;
    }
    if (event.key === "Escape") {
      if (dialogRef.current?.open || threadsRef.current?.open) return;
      if (reportOpen) collapseReport();
      else if (run) cancelResearch();
      else closeRegion();
    }
    if (
      event.key === "/" &&
      !(
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
      )
    ) {
      event.preventDefault();
      openSearch();
    }
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => keyboard(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function startResearch(point: MapPoint, input = "") {
    cancelResearch();
    chatRequest.current?.abort();
    setAsking(false);
    setChatError("");
    dialogRef.current?.close();
    threadsRef.current?.close();
    setNotice("");
    closeRegion();
    if (reportOpen) {
      setReportOpen(false);
      history.replaceState(null, "", location.pathname + location.search);
      reportRouteAdded.current = false;
    }
    const controller = new AbortController();
    researchRequest.current = controller;
    collapsedRef.current = false;
    const demo = findDemoArea({ lat: point.lat, lng: point.lon });
    const name =
      demo?.name || point.name || `Neighborhood at ${coordinate(point)}`;
    const question = input.trim() || DEFAULT_QUESTION;
    enter();
    globeRef.current?.focus(point, { radiusKm: RADIUS_KM, selectPoint: false });
    globeRef.current?.startResearch(point);
    setRun({
      name,
      question,
      step: "Collecting neighborhood evidence and comparing business categories…",
      collapsed: false,
    });
    try {
      const analysis = await requestJSON<Analysis>(
        "/api/analyze",
        { lat: point.lat, lng: point.lon },
        controller.signal,
      );
      if (controller.signal.aborted || researchRequest.current !== controller)
        return;
      if (!isAnalysis(analysis))
        throw new Error(
          "The analysis response was incomplete. Please try again.",
        );
      globeRef.current?.setRecords([
        ...new Map(
          [...recordsRef.current, ...mapRecords(analysis.docs)].map(
            (record) => [record.id, record],
          ),
        ).values(),
      ]);
      const next: Report = {
        id: crypto.randomUUID(),
        name,
        question,
        createdAt: new Date().toISOString(),
        analysis,
        conversation: [],
      };
      if (input.trim()) {
        setRun(
          (current) =>
            current && {
              ...current,
              step: "Answering your question from the collected sources…",
            },
        );
        try {
          const response = await requestJSON<AskResponse>(
            "/api/ask",
            { question, docs: analysis.docs },
            controller.signal,
            60_000,
          );
          if (!controller.signal.aborted)
            next.conversation.push({ question, response });
        } catch (error) {
          if (controller.signal.aborted) return;
          setNotice(
            `The analysis is ready, but the question could not be answered: ${message(error)} You can ask again in the report.`,
          );
        }
      }
      if (controller.signal.aborted || researchRequest.current !== controller)
        return;
      persist([next, ...reportsRef.current].slice(0, 6));
      setRun(null);
      researchRequest.current = null;
      globeRef.current?.stopResearch();
      if (!collapsedRef.current) openReport(next);
      else
        setNotice(
          `Research for ${name} is ready. Open Threads to view the report.`,
        );
    } catch (error) {
      if (controller.signal.aborted || researchRequest.current !== controller)
        return;
      setNotice(message(error));
      researchRequest.current = null;
      setRun(null);
      globeRef.current?.stopResearch();
      // Restore the selection for retry without issuing another source request.
      setSelection({
        point,
        status: "error",
        error: "Analysis did not complete. You can try again.",
      });
    }
  }
  // Opens a suggestion's saved thread: the place's analysis with the question already answered, so
  // nothing calls /api/analyze or /api/ask. Follow-ups in it are asked live, as in any thread.
  async function openSuggestion(suggestion: Suggestion) {
    cancelResearch();
    dialogRef.current?.close();
    setNotice("");
    closeRegion();
    const point = {
      lat: suggestion.place.center.lat,
      lon: suggestion.place.center.lng,
      name: suggestion.place.name,
    };
    enter();
    globeRef.current?.focus(point, { radiusKm: RADIUS_KM, selectPoint: false });
    const opened = reportsRef.current.find(
      (item) => item.id === threadId(suggestion.id),
    );
    if (opened) {
      openReport(opened);
      return;
    }
    const controller = new AbortController();
    researchRequest.current = controller;
    // The thread is usually loaded already; show progress only if it isn't there quickly.
    const slow = setTimeout(
      () =>
        setRun({
          name: suggestion.place.name,
          question: suggestion.question,
          step: "Opening saved research…",
          collapsed: false,
        }),
      400,
    );
    try {
      const saved = await loadSuggestion(suggestion.id);
      if (controller.signal.aborted) return;
      globeRef.current?.setRecords([
        ...new Map(
          [...recordsRef.current, ...mapRecords(saved.analysis.docs)].map(
            (record) => [record.id, record],
          ),
        ).values(),
      ]);
      persist(
        [saved, ...reportsRef.current.filter((item) => item.id !== saved.id)].slice(0, 6),
      );
      openReport(saved);
    } catch {
      // No saved thread (for example, a suggestion added since the last save): research it live.
      if (!controller.signal.aborted)
        void startResearch(point, suggestion.question);
    } finally {
      clearTimeout(slow);
      if (researchRequest.current === controller) {
        researchRequest.current = null;
        setRun(null);
      }
    }
  }
  async function askFollowup(question: string): Promise<boolean> {
    const current = report;
    if (!current || asking) return false;
    const controller = new AbortController();
    chatRequest.current?.abort();
    chatRequest.current = controller;
    setAsking(true);
    setChatError("");
    try {
      const history = current.conversation.slice(-4).flatMap((turn) => [
        { role: "user", content: turn.question },
        { role: "assistant", content: turn.response.answer },
      ]);
      const response = await requestJSON<AskResponse>(
        "/api/ask",
        { question, docs: current.analysis.docs, history },
        controller.signal,
        60_000,
      );
      if (controller.signal.aborted || activeReportRef.current !== current.id)
        return false;
      const next = {
        ...current,
        conversation: [...current.conversation, { question, response }],
      };
      setReport(next);
      persist(
        reportsRef.current.map((item) => (item.id === next.id ? next : item)),
      );
      return true;
    } catch (error) {
      if (!controller.signal.aborted) setChatError(message(error));
      return false;
    } finally {
      if (chatRequest.current === controller) setAsking(false);
    }
  }
  function locate(doc: SourceDoc) {
    if (!Number.isFinite(doc.lat) || !Number.isFinite(doc.lng)) return;
    collapseReport();
    void selectRegion({ lat: doc.lat!, lon: doc.lng!, name: doc.title }, true);
  }
  const typed = query.trim().toLowerCase();
  const searchItems: SearchItem[] = typed
    ? [
        {
          kind: "question",
          title: query.trim(),
          description: "Ask using neighborhood sources",
          point: null,
        },
        ...SUGGESTIONS.filter((suggestion) =>
          `${suggestion.question} ${suggestion.place.name}`
            .toLowerCase()
            .includes(typed),
        ).map(suggestionItem),
        ...DEMO_AREAS.filter((area) =>
          area.name.toLowerCase().includes(typed),
        ).map(placeItem),
      ]
    : [...SUGGESTIONS.map(suggestionItem), ...DEMO_AREAS.map(placeItem)];
  const prefetch = (item: SearchItem | undefined) => {
    if (item?.suggestion) void loadSuggestion(item.suggestion.id);
  };
  function chooseResult(index: number) {
    const item = searchItems[index];
    if (!item) return;
    dialogRef.current?.close();
    if (item.suggestion) {
      void openSuggestion(item.suggestion);
      return;
    }
    if (item.point) {
      if (reportOpen) collapseReport();
      enter();
      void selectRegion(item.point, true);
      return;
    }
    const scope =
      searchScope === "selected" && selection
        ? selection.point
        : (() => {
            const area =
              DEMO_AREAS.find((area) => area.slug === searchScope) ||
              DEMO_AREAS[0];
            return {
              lat: area.center.lat,
              lon: area.center.lng,
              name: area.name,
            };
          })();
    void startResearch(scope, item.title);
  }
  const selectedDocs = (selection?.area?.docs ?? []).filter((doc) =>
    activeSources.has(types.findIndex((type) => type.id === doc.source)),
  );
  const activeIndex = Math.min(activeResult, searchItems.length - 1);
  return (
    <>
      <header className="navigation">
        <a
          href="#"
          className="wordmark"
          aria-label="Whitespace home"
          onClick={(event) => {
            event.preventDefault();
            if (reportOpen) collapseReport();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="m3 8 6 17 7-17 7 17 6-17" />
          </svg>
          whitespace
        </a>
        <div className="nav-right">
          <button
            ref={searchRef}
            id="search"
            className="search-wrap search-trigger"
            aria-label="Search questions and places"
            aria-haspopup="dialog"
            onClick={openSearch}
          >
            <SearchIcon />
            <span className="search-label">Search &amp; ask</span>
            <kbd>⌘ K</kbd>
          </button>
        </div>
      </header>
      <main id="experience" ref={experienceRef}>
        <div id="stage" ref={stageRef}>
          <div
            id="space"
            ref={spaceRef}
            role="img"
            aria-label="Interactive Earth. Drag to rotate and click to select a neighborhood. Search provides a keyboard alternative."
          />
          <canvas id="signals" ref={signalsRef} aria-hidden="true" />
          <div className="cinematic-shade" />
          <section className="hero" id="hero" ref={heroRef}>
            <h1>Opportunity is everywhere.</h1>
          </section>
          {mapStatus !== "ready" && (
            <div id="loading" role="status" aria-busy={mapStatus === "loading"}>
              {mapStatus === "loading" ? (
                <>
                  <span className="sr-only">Loading Earth…</span>
                  <div className="earth-loading-lines" aria-hidden="true">
                    <span className="skeleton" />
                    <span className="skeleton" />
                  </div>
                </>
              ) : (
                <span className="load-error">
                  The 3D view could not load.{" "}
                  <button onClick={openSearch}>
                    Search a neighborhood to continue ↗
                  </button>
                </span>
              )}
            </div>
          )}
          <button
            id="scroll-cue"
            ref={cueRef}
            className="scroll-cue"
            onClick={enter}
          >
            <span>SCROLL TO DISCOVER</span>
            <span className="scroll-line" />
          </button>
          <section
            id="explore-ui"
            ref={controlsRef}
            className="explore-ui"
            aria-label="Globe controls"
            inert
          >
            <div
              className="neighborhood-shortcuts"
              aria-label="Saved neighborhoods"
            >
              {DEMO_AREAS.map((area) => (
                <button
                  key={area.slug}
                  onClick={() => {
                    enter();
                    void selectRegion(
                      {
                        lat: area.center.lat,
                        lon: area.center.lng,
                        name: area.name,
                      },
                      true,
                    );
                  }}
                >
                  {area.name} ↗
                </button>
              ))}
              <small>
                {index
                  ? `${index.records.length.toLocaleString()} places mapped · featured neighborhoods`
                  : "Choose a neighborhood or select a point"}
              </small>
            </div>
            <button
              id="threads-toggle"
              className="threads-toggle"
              aria-label="Open query history"
              aria-haspopup="dialog"
              aria-controls="threads-panel"
              onClick={() => {
                closeRegion();
                threadsRef.current?.showModal();
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" />
              </svg>
              <span>Threads{reports.length ? ` · ${reports.length}` : ""}</span>
            </button>
            <div className="map-navigation">
              <div className="map-scale">
                <span id="scale-label" ref={scaleRef}>
                  —
                </span>
                <div />
              </div>
              <div className="map-tools">
                <button
                  aria-label="Zoom in"
                  disabled={mapStatus !== "ready"}
                  onClick={() => globeRef.current?.zoom(-0.45)}
                >
                  +
                </button>
                <span />
                <button
                  aria-label="Zoom out"
                  disabled={mapStatus !== "ready"}
                  onClick={() => globeRef.current?.zoom(0.45)}
                >
                  −
                </button>
                <span />
                <button
                  aria-label="Reset view"
                  disabled={mapStatus !== "ready"}
                  onClick={() => globeRef.current?.reset()}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 9a8 8 0 1 1 0 7M4 3v6h6" />
                  </svg>
                </button>
              </div>
            </div>
            {(imagery || reference) && (
              <div id="imagery-credit" className="imagery-credit">
                Imagery ©{" "}
                <a
                  href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
                  target="_blank"
                  rel="noreferrer"
                >
                  Esri, Vantor, Earthstar Geographics
                </a>{" "}
                · Map data © Esri, HERE, Garmin,{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenStreetMap
                </a>{" "}
                contributors
              </div>
            )}
            <div className="source-dock" aria-label="Filter map sources">
              <div id="source-filters">
                {types.map((type, i) => (
                  <button
                    key={type.id}
                    aria-pressed={activeSources.has(i)}
                    title={`${type.source} · filters the map; research uses all sources`}
                    onClick={() => {
                      const next = new Set(activeSources);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      setActiveSources(next);
                      globeRef.current?.filter(next);
                    }}
                  >
                    <span className={`type-icon type-${type.id}`}>
                      <Icon id={type.id} />
                    </span>
                    <span>{type.name}</span>
                    <span className="filter-indicator" />
                  </button>
                ))}
              </div>
            </div>
            <div className="explore-footnote">
              <span>
                Drag to orbit <b>·</b> Select a neighborhood to research
              </span>
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              >
                Back to the horizon ↑
              </button>
            </div>
          </section>
          {tooltip && !selection && (
            <div
              id="pin-tooltip"
              style={{
                left: Math.max(
                  90,
                  Math.min(
                    typeof innerWidth === "number" ? innerWidth - 100 : 1000,
                    tooltip.x,
                  ),
                ),
                top: tooltip.y + 24,
              }}
            >
              {tooltip.text}
            </div>
          )}
          {selection && (
            <section
              className="region-card"
              id="region-card"
              aria-label="Ask about this region"
              aria-busy={selection.status === "loading"}
            >
              <div className="region-card-top">
                <span className="eyebrow">NEIGHBORHOOD</span>
                <button aria-label="Close region" onClick={closeRegion}>
                  ×
                </button>
              </div>
              <h2>{selection.point.name}</h2>
              <div className="region-meta">
                <span>{coordinate(selection.point)}</span>
                <span className="meta-dot">·</span>
                <span>{AREA_RADIUS_M} m radius</span>
              </div>
              <div className="region-sources" aria-live="polite">
                {selection.status === "loading" ? (
                  <p className="empty-region">Loading neighborhood sources…</p>
                ) : selection.status === "error" ? (
                  <>
                    <p role="alert" className="empty-region">
                      {selection.error}
                    </p>
                    <button
                      className="secondary-button"
                      onClick={() => void selectRegion(selection.point)}
                    >
                      Retry sources
                    </button>
                  </>
                ) : (
                  <>
                    <div className="region-total">
                      <span className="live-dot" />
                      <strong>
                        {selectedDocs.length.toLocaleString()}
                      </strong>{" "}
                      source documents shown
                    </div>
                    <div className="source-breakdown">
                      {types.map((type, i) => {
                        const count = selectedDocs.filter(
                          (doc) => doc.source === type.id,
                        ).length;
                        return count ? (
                          <span
                            key={i}
                            title={`${count} ${type.source} documents`}
                          >
                            <Icon id={type.id} />
                            {count}
                          </span>
                        ) : null;
                      })}
                    </div>
                    <p className="source-provenance">
                      {selection.area?.mock && "Test mode · sample sources · "}
                      {selection.area?.businesses.length.toLocaleString()}{" "}
                      businesses
                    </p>
                    {!activeSources.size && (
                      <p className="empty-region">
                        All map sources are off. Turn on a source to see
                        records.
                      </p>
                    )}
                  </>
                )}
              </div>
              <button
                className="analyze-button"
                onClick={() => void startResearch(selection.point)}
              >
                Find business opportunities ↗
              </button>
              <p className="region-prompt">Or ask about this neighborhood</p>
              <form
                id="ask-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (question.trim())
                    void startResearch(selection.point, question);
                }}
              >
                <textarea
                  id="ask-input"
                  rows={2}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="What would do well here?"
                  aria-label="Question about this region"
                  maxLength={2000}
                  required
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button
                  type="submit"
                  aria-label="Ask question"
                  disabled={!question.trim()}
                >
                  ↑
                </button>
              </form>
              <p className="card-footnote">
                Research covers the {AREA_RADIUS_M.toLocaleString()} m around
                this point.
              </p>
              <div className="place-credit">
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  © OpenStreetMap
                </a>{" "}
                ·{" "}
                <a
                  href="https://www.google.com/intl/en_US/help/terms_maps/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google Places
                </a>{" "}
                · US Census · Wikipedia
              </div>
            </section>
          )}
        </div>
      </main>
      {run && (
        <aside
          id="research-loading"
          className="research-loading"
          aria-label="Research in progress"
          hidden={run.collapsed}
          aria-busy="true"
        >
          <div className="research-loading-top">
            <span className="research-orbit" aria-hidden="true">
              ✳
            </span>
            <span>Researching this neighborhood</span>
            <button aria-label="Cancel research" onClick={cancelResearch}>
              ×
            </button>
          </div>
          <h2>{run.question}</h2>
          <p className="research-scope">
            {run.name} · {AREA_RADIUS_M} m radius
          </p>
          <p role="status">{run.step}</p>
          <div className="research-skeleton" aria-hidden="true">
            <b className="skeleton" />
            <i className="skeleton" />
            <i className="skeleton" />
            <i className="skeleton" />
          </div>
          <button
            className="research-map-button"
            onClick={() => {
              collapsedRef.current = true;
              setRun((current) => current && { ...current, collapsed: true });
            }}
          >
            Continue exploring ↗
          </button>
        </aside>
      )}
      {run?.collapsed && (
        <div className="background-research">
          <button
            onClick={() => {
              collapsedRef.current = false;
              setRun((current) => current && { ...current, collapsed: false });
            }}
          >
            Researching {run.name}…
          </button>
          <button
            onClick={cancelResearch}
            aria-label="Cancel background research"
          >
            ×
          </button>
        </div>
      )}
      {report && (
        <section
          id="research-results"
          className="research-results model-output-view"
          aria-label="Neighborhood research report"
          hidden={!reportOpen}
        >
          <button className="output-collapse" onClick={collapseReport}>
            ↙ Back to globe
          </button>
          <article
            id="model-output"
            className="model-output"
            tabIndex={-1}
            ref={outputRef}
          >
            {reportOpen && (
              <ResearchReport
                key={report.id}
                report={report}
                asking={asking}
                chatError={chatError}
                onAsk={askFollowup}
                onLocate={locate}
              />
            )}
          </article>
        </section>
      )}
      {notice && (
        <p id="ui-notice" className="ui-notice" role="alert">
          {notice}
          <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
            ×
          </button>
        </p>
      )}
      <dialog
        id="threads-panel"
        ref={threadsRef}
        className="threads-panel"
        aria-labelledby="threads-heading"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <header className="threads-header">
          <h2 id="threads-heading">Threads</h2>
          <button
            aria-label="Close query history"
            onClick={() => threadsRef.current?.close()}
          >
            ×
          </button>
        </header>
        <label className="threads-search">
          <SearchIcon />
          <input
            type="search"
            aria-label="Find a past query"
            placeholder="Find a thread"
            value={threadFilter}
            onChange={(event) => setThreadFilter(event.target.value)}
          />
        </label>
        <div className="threads-list">
          {reports
            .filter((item) =>
              `${item.name} ${item.question}`
                .toLowerCase()
                .includes(threadFilter.toLowerCase()),
            )
            .map((item) => (
              <button
                key={item.id}
                className="thread-history-item"
                onClick={() => openReport(item)}
              >
                <strong>{item.question}</strong>
                <span>
                  {item.name} · {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          {!reports.length && (
            <p className="threads-empty">
              Your completed neighborhood research will appear here.
            </p>
          )}
        </div>
        <footer className="threads-storage">
          {storageWarning
            ? "Browser storage is unavailable or full. Keep this tab open to retain your current reports."
            : "Up to six recent reports are stored in this browser, within its storage limit."}
          {reports.length > 0 && (
            <button
              onClick={() => {
                persist([]);
                setReport(null);
                activeReportRef.current = null;
              }}
            >
              Clear history
            </button>
          )}
        </footer>
      </dialog>
      <dialog
        id="spotlight"
        ref={dialogRef}
        aria-label="Search the world"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <form
          className="spotlight-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            chooseResult(activeIndex);
          }}
        >
          <SearchIcon />
          <input
            ref={searchInputRef}
            id="spotlight-input"
            type="search"
            placeholder="Ask a question or find a place"
            aria-label="Search questions and places"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="search-results"
            aria-activedescendant={`search-result-${activeIndex}`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveResult(0);
            }}
            maxLength={2000}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const next =
                  (activeIndex +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    searchItems.length) %
                  searchItems.length;
                setActiveResult(next);
                prefetch(searchItems[next]);
                document
                  .getElementById(`search-result-${next}`)
                  ?.scrollIntoView({ block: "nearest" });
              }
            }}
          />
          <button
            id="close-search"
            type="button"
            aria-label="Close search"
            onClick={() => dialogRef.current?.close()}
          >
            <span>esc</span>
            <span className="close-search-mobile">×</span>
          </button>
        </form>
        <div
          id="search-results"
          role="listbox"
          aria-label="Questions and places"
        >
          {searchItems.map((item, i) => (
            <button
              key={`${item.kind}-${item.title}`}
              type="button"
              role="option"
              aria-selected={activeIndex === i}
              id={`search-result-${i}`}
              className={`spotlight-row ${activeIndex === i ? "is-active" : ""}`}
              onPointerEnter={() => prefetch(item)}
              onFocus={() => prefetch(item)}
              onClick={() => chooseResult(i)}
            >
              <span className="result-icon">
                <Icon id={item.kind === "place" ? "osm" : "wikipedia"} />
              </span>
              <span className="result-copy">
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
              <span className="result-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>
        <footer className="spotlight-footer">
          <label>
            Ask in{" "}
            <select
              id="search-region"
              aria-label="Location for your question"
              value={searchScope}
              onChange={(event) => setSearchScope(event.target.value)}
            >
              {selection && (
                <option value="selected">Selected neighborhood</option>
              )}
              {DEMO_AREAS.map((area) => (
                <option key={area.slug} value={area.slug}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>
          <div className="spotlight-keys">
            <span>
              ↑ ↓ <span>navigate</span>
            </span>
            <span>
              ↵ <span>open</span>
            </span>
          </div>
        </footer>
      </dialog>
    </>
  );
}
