import { useState } from "react";
import type { BusinessSummary } from "@/lib/analysis/summaries";
import type { AskResponse, SourceDoc } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/ingest/categories";
import type { CategoryId } from "@/lib/types";
import { GAP_LABELS, safeURL } from "./data";
import type { Report } from "./types";

const categoryName = (id: string) =>
  CATEGORY_LABELS[id as CategoryId] || id.replaceAll("_", " ");
const number = (value: number | null | undefined) =>
  value == null ? "Unavailable" : Math.round(value).toLocaleString();

export function Answer({ response }: { response: AskResponse }) {
  return (
    <div className="cited-answer">
      <p>
        {response.answer.split(/(\[\d+\])/g).map((part, i) => {
          const match = /^\[(\d+)\]$/.exec(part);
          const citation = match
            ? response.citations[Number(match[1]) - 1]
            : undefined;
          const href = citation && safeURL(citation.url);
          return href ? (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noreferrer"
              title={citation.title}
            >
              {part}
            </a>
          ) : (
            part
          );
        })}
      </p>
      {!!response.citations.length && (
        <ol className="citation-list">
          {response.citations.map((citation, i) => (
            <li key={`${citation.id}-${i}`}>
              <a href={safeURL(citation.url)} target="_blank" rel="noreferrer">
                {citation.title}
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Evidence({ ids, docs }: { ids: string[]; docs: SourceDoc[] }) {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  return (
    <div className="evidence-links">
      {ids.map((id) => {
        const doc = byId.get(id);
        return doc ? (
          <a key={id} href={safeURL(doc.url)} target="_blank" rel="noreferrer">
            {doc.title} ↗
          </a>
        ) : null;
      })}
    </div>
  );
}

function ReviewSummary({
  summary,
  docs,
}: {
  summary: BusinessSummary;
  docs: SourceDoc[];
}) {
  const reviews = summary.evidence.flatMap(
    (id) => docs.find((doc) => doc.id === id) ?? [],
  );
  return (
    <div className="review-summary">
      {summary.knownFor && (
        <p>
          <strong>Known for:</strong> {summary.knownFor}
        </p>
      )}
      {summary.complaints && (
        <p>
          <strong>Complaints:</strong> {summary.complaints}
        </p>
      )}
      {!!reviews.length && (
        <div className="review-links">
          {reviews.map((doc, i) => (
            <a
              key={doc.id}
              href={safeURL(doc.url)}
              target="_blank"
              rel="noreferrer"
              title={doc.title}
            >
              Review {i + 1} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResearchReport({
  report,
  asking,
  chatError,
  onAsk,
  onLocate,
}: {
  report: Report;
  asking: boolean;
  chatError: string;
  onAsk(question: string): Promise<boolean>;
  onLocate(doc: SourceDoc): void;
}) {
  const [question, setQuestion] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceLimit, setSourceLimit] = useState(30);
  const [businessCategory, setBusinessCategory] = useState("all");
  const { analysis } = report;
  const docs = analysis.docs;
  const demographics = analysis.demographics;
  const sources = docs.filter((doc) =>
    `${doc.title} ${doc.source}`
      .toLowerCase()
      .includes(sourceQuery.toLowerCase()),
  );
  const summaries = new Map(
    (analysis.summaries ?? []).map((summary) => [summary.businessId, summary]),
  );
  // Businesses with review summaries first; the sort is stable, so the rest keep their order.
  const businesses = analysis.businesses
    .filter(
      (b) => businessCategory === "all" || b.category === businessCategory,
    )
    .sort((a, b) => Number(summaries.has(b.id)) - Number(summaries.has(a.id)));
  return (
    <>
      <header className="report-heading">
        <p className="eyebrow">
          NEIGHBORHOOD RESEARCH · {analysis.radiusM.toLocaleString()} M RADIUS
        </p>
        <h1>{report.name}</h1>
        <p className="report-question">{report.question}</p>
        <p className="report-provenance">
          {analysis.mock
            ? "Test mode · sample analysis"
            : analysis.from === "saved"
              ? "Collected source snapshot · AI analysis"
              : "Live source collection · AI analysis"}{" "}
          · {new Date(report.createdAt).toLocaleString()}
        </p>
      </header>
      {analysis.mock && (
        <p className="report-warning" role="note">
          Test mode is enabled. This report contains sample data.
        </p>
      )}
      {!!analysis.errors?.length && (
        <p className="report-warning" role="status">
          Some results are unavailable:{" "}
          {[...new Set(analysis.errors.map((issue) => issue.source))].join(
            ", ",
          )}
          . Available evidence is shown below.
        </p>
      )}
      <div className="report-metrics">
        <div>
          <strong>{analysis.businesses.length.toLocaleString()}</strong>
          <span>Businesses</span>
        </div>
        <div>
          <strong>{number(demographics?.population)}</strong>
          <span>Residents, estimated</span>
        </div>
        <div>
          <strong>
            {demographics?.medianIncome == null
              ? "Unavailable"
              : `$${number(demographics.medianIncome)}`}
          </strong>
          <span>Median income, estimated</span>
        </div>
        <div>
          <strong>{docs.length.toLocaleString()}</strong>
          <span>Source documents</span>
        </div>
      </div>
      <nav className="report-nav" aria-label="Report sections">
        {["opportunities", "gaps", "businesses", "sources", "conversation"].map(
          (id) => (
            <button
              key={id}
              onClick={() =>
                document
                  .getElementById(`report-${id}`)
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              {id === "conversation" ? "Ask a question" : categoryName(id)}
            </button>
          ),
        )}
      </nav>
      <section id="report-opportunities" className="report-section">
        <h2>Business opportunities</h2>
        {analysis.concepts.length ? (
          analysis.concepts.map((concept) => (
            <article key={concept.title} className="opportunity-card">
              <span className="eyebrow">{categoryName(concept.category)}</span>
              {concept.gapType && (
                <span className="gap-type">{GAP_LABELS[concept.gapType]}</span>
              )}
              <h3>{concept.title}</h3>
              <p>{concept.rationale}</p>
              {(analysis.signals ?? [])
                .filter((signal) => signal.category === concept.category)
                .map((signal) => (
                  <ul key={signal.category} className="card-signals">
                    {signal.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ))}
              <Evidence ids={concept.evidence} docs={docs} />
              <p className="risk">
                <strong>What to test</strong> {concept.risk}
              </p>
              {(analysis.profiles ?? [])
                .filter((profile) => profile.category === concept.category)
                .map((profile) => (
                  <details
                    key={profile.category}
                    className="competitor-profile"
                  >
                    <summary>
                      Competitor signals · {profile.reviewCount} reviews within{" "}
                      {profile.radiusM / 1000} km
                    </summary>
                    <p>
                      Small review samples describe these competitors; they do
                      not establish statistical significance.
                    </p>
                    {profile.findings.length ? (
                      profile.findings.map((finding, i) => (
                        <div key={i}>
                          <h4>{finding.label}</h4>
                          <p>
                            {finding.top.count} of {finding.top.of} in the
                            top-rated group · {finding.low.count} of{" "}
                            {finding.low.of} in the lower-rated group (
                            {finding.kind === "attribute"
                              ? "businesses"
                              : "reviews"}
                            )
                          </p>
                          <Evidence ids={finding.evidence} docs={docs} />
                        </div>
                      ))
                    ) : (
                      <p>No clear differences in the available sample.</p>
                    )}
                  </details>
                ))}
            </article>
          ))
        ) : (
          <p>
            {demographics
              ? "No concepts are available. Review the category gaps and source evidence, or try the analysis again."
              : "Demographic benchmarks are available for US neighborhoods. Business and source evidence can still be explored here."}
          </p>
        )}
      </section>
      <section id="report-gaps" className="report-section">
        <h2>Category gaps</h2>
        <p>
          Businesses per 1,000 residents compared with the project’s regional
          benchmarks. A larger gap is a signal to investigate.
        </p>
        {analysis.gaps.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Local / 1k</th>
                  <th>Benchmark / 1k</th>
                  <th>Gap score</th>
                </tr>
              </thead>
              <tbody>
                {analysis.gaps.map((gap) => (
                  <tr key={gap.category}>
                    <th scope="row">{categoryName(gap.category)}</th>
                    <td>{gap.localPer1k.toFixed(2)}</td>
                    <td>{gap.benchmarkPer1k.toFixed(2)}</td>
                    <td>{gap.score.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No demographic benchmark is available for this location.</p>
        )}
      </section>
      <section id="report-businesses" className="report-section">
        <h2>Businesses in this area</h2>
        <label className="report-control">
          Category{" "}
          <select
            aria-label="Business category"
            value={businessCategory}
            onChange={(event) => setBusinessCategory(event.target.value)}
          >
            <option value="all">All categories</option>
            {[...new Set(analysis.businesses.map((b) => b.category))]
              .sort()
              .map((category) => (
                <option key={category} value={category}>
                  {categoryName(category)}
                </option>
              ))}
          </select>
        </label>
        {businesses.length ? (
          <ul className="business-list">
            {businesses.map((business) => (
              <li key={business.id}>
                <div>
                  <a
                    href={safeURL(business.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {business.name} ↗
                  </a>
                  <span>
                    {categoryName(business.category)}
                    {business.rating != null
                      ? ` · ${business.rating.toFixed(1)} ★`
                      : ""}
                    {business.status && business.status !== "open"
                      ? ` · ${business.status.replaceAll("_", " ")}`
                      : ""}
                  </span>
                  {summaries.has(business.id) && (
                    <ReviewSummary
                      summary={summaries.get(business.id)!}
                      docs={docs}
                    />
                  )}
                </div>
                <button
                  onClick={() =>
                    onLocate({
                      id: business.id,
                      title: business.name,
                      lat: business.lat,
                      lng: business.lng,
                      source: "osm",
                      text: "",
                      url: business.url,
                    })
                  }
                >
                  Show on globe
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No businesses in this category.</p>
        )}
      </section>
      <section id="report-sources" className="report-section">
        <h2>Source evidence</h2>
        <p>
          Collected documents used by the analysis. Census tracts, Wikipedia
          context, and competitors can extend beyond the neighborhood circle.
        </p>
        <label className="report-control">
          Find a source{" "}
          <input
            type="search"
            aria-label="Find a source"
            value={sourceQuery}
            onChange={(event) => {
              setSourceQuery(event.target.value);
              setSourceLimit(30);
            }}
            placeholder="Name or source type"
          />
        </label>
        <div className="source-documents">
          {sources.slice(0, sourceLimit).map((doc) => (
            <details key={doc.id}>
              <summary>
                <span>{doc.title}</span>
                <small>{doc.source}</small>
              </summary>
              <p>{doc.text}</p>
              <div className="source-document-actions">
                <a href={safeURL(doc.url)} target="_blank" rel="noreferrer">
                  Open source ↗
                </a>
                {Number.isFinite(doc.lat) && Number.isFinite(doc.lng) && (
                  <button onClick={() => onLocate(doc)}>Show on globe</button>
                )}
              </div>
            </details>
          ))}
        </div>
        {!sources.length && <p>No matching source documents.</p>}
        {sources.length > sourceLimit && (
          <button
            className="secondary-button"
            onClick={() => setSourceLimit((limit) => limit + 30)}
          >
            Show more sources ({sources.length - sourceLimit} remaining)
          </button>
        )}
      </section>
      <section id="report-conversation" className="report-section">
        <h2>Ask about this neighborhood</h2>
        <p>
          Answers use the sources in this report. Follow-up questions include
          the recent conversation.
        </p>
        <div aria-live="polite">
          {report.conversation.map((turn, i) => (
            <div key={i} className="conversation-turn">
              <p className="chat-question">{turn.question}</p>
              <Answer response={turn.response} />
            </div>
          ))}
        </div>
        <form
          className="followup-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const query = question.trim();
            if (query && (await onAsk(query))) setQuestion("");
          }}
        >
          <label className="sr-only" htmlFor="followup-question">
            Follow-up question
          </label>
          <textarea
            id="followup-question"
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={2000}
            required
            placeholder="Which opportunity has the strongest evidence?"
            disabled={asking}
          />
          <button type="submit" disabled={asking || !question.trim()}>
            {asking ? "Reading the sources…" : "Ask question ↗"}
          </button>
        </form>
        {chatError && (
          <p role="alert" className="report-warning">
            {chatError}
          </p>
        )}
      </section>
    </>
  );
}
