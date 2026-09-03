import React, { useMemo, useState } from "react";

import {
  DataComponent,
  DataTable,
  Dropdown,
  EvidenceChart,
  SectionHeader,
  SegmentedControl,
  useDataApp,
  useDashboardTabs,
} from "../../data-app-public.jsx";
import "./dashboard.css";
import { useForecastLedgerTools } from "./use-forecast-ledger-tools.js";

const priceSpec = {
  type: "line",
  x: "date",
  y: "mae_model",
  fields: ["mae_model", "mae_b1", "mae_b2"],
  colors: {
    mae_model: "var(--chart-1)",
    mae_b1: "var(--chart-4)",
    mae_b2: "var(--chart-2)",
  },
  legend: {
    labels: {
      mae_model: "Model",
      mae_b1: "Same hour last week",
      mae_b2: "Same hour yesterday",
    },
  },
  valueDecimals: 1,
  showLegend: true,
  showXAxisLabel: false,
  showYAxisLabel: false,
};

const coverageSpec = {
  type: "line",
  x: "date",
  y: "coverage80Rate",
  fields: ["coverage80Rate", "nominal80Rate", "coverage50Rate", "nominal50Rate"],
  colors: {
    coverage80Rate: "var(--chart-1)",
    nominal80Rate: "var(--secondary)",
    coverage50Rate: "var(--chart-3)",
    nominal50Rate: "var(--secondary)",
  },
  legend: {
    labels: {
      coverage80Rate: "80% interval",
      nominal80Rate: "80% nominal",
      coverage50Rate: "50% interval",
      nominal50Rate: "50% nominal",
    },
  },
  valueDecimals: 2,
  showLegend: true,
  showXAxisLabel: false,
  showYAxisLabel: false,
};

const hourlyPriceSpec = {
  type: "line",
  x: "hourLocal",
  y: "price",
  fields: ["price", "pointForecast", "interval80Low", "interval80High"],
  colors: {
    price: "var(--text)",
    pointForecast: "var(--chart-1)",
    interval80Low: "var(--chart-8)",
    interval80High: "var(--chart-8)",
  },
  legend: {
    labels: {
      price: "Realised",
      pointForecast: "Forecast",
      interval80Low: "80% lower",
      interval80High: "80% upper",
    },
  },
  currency: "EUR",
  valueDecimals: 1,
  showLegend: true,
  showXAxisLabel: false,
  showYAxisLabel: false,
};

const integer = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signedPercent = new Intl.NumberFormat("en-GB", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "always",
});
const percent = new Intl.NumberFormat("en-GB", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const euro = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 1,
});

function formatDay(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatInstant(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
    timeZoneName: "short",
  }).format(new Date(value));
}

function SharedFocus({ activity, registration }) {
  const toolLabel = registration.status === "ready"
    ? `${registration.count} site tools ready`
    : registration.status === "unsupported"
      ? "WebMCP unavailable in this browser"
      : registration.status === "error"
        ? "Site-tool registration failed"
        : "Checking site tools";
  return (
    <div className="shared-focus" role="status" aria-live="polite" data-origin={activity.origin}>
      <span>{activity.origin === "agent" ? "Agent focus" : "Shared focus"}</span>
      <strong>{activity.title}</strong>
      <p>{activity.detail}</p>
      <span className="site-tool-state" data-status={registration.status}>{toolLabel}</span>
    </div>
  );
}

function RecordMetric({ id, queryId, title, value, detail, tone = "neutral", rows }) {
  return (
    <DataComponent
      variant="card"
      padding="spacious"
      id={id}
      queryId={queryId}
      kind="metric"
      title={title}
      sourceRows={rows}
      displayRows={rows}
      className="record-metric"
    >
      <strong data-tone={tone}>{value}</strong>
      <span>{detail}</span>
    </DataComponent>
  );
}

function StatusPill({ value }) {
  return <span className="ledger-status" data-status={String(value).toLowerCase()}>{value}</span>;
}

function Overview({ queries, activity, registration, comparison }) {
  const cumulative = queries.cumulative_record.rows;
  const track = queries.track_record.rows;
  const ledger = queries.ledger_status.rows;
  const integrity = queries.integrity.rows;
  const latest = cumulative.at(-1);
  const missed = ledger.filter((row) => row.status === "MISSED");
  const coverageRows = cumulative.map((row) => ({
    ...row,
    coverage80Rate: row.coverage_80,
    nominal80Rate: row.nominal_80,
    coverage50Rate: row.coverage_50,
    nominal50Rate: row.nominal_50,
  }));
  const runningSkill = latest?.skill_vs_b1;
  const warnings = integrity.filter((row) => row.status !== "PASS");

  return (
    <article className="forecast-view" aria-labelledby="overview-heading">
      <SharedFocus activity={activity} registration={registration} />
      <SectionHeader id="overview-heading" title="Prospective record" />

      {comparison && (
        <DataComponent
          variant="card"
          id="agent-price-comparison"
          queryId="track_record"
          kind="custom"
          title={`${comparison.baseline} comparison · ${formatDay(comparison.start_date)} to ${formatDay(comparison.end_date)}`}
          description="Agent-selected descriptive range. This does not replace the fixed-window bootstrap assessment."
          sourceRows={track.filter((row) => row.date >= comparison.start_date && row.date <= comparison.end_date)}
          displayRows={[comparison]}
          className="agent-comparison"
        >
          <div className="comparison-facts">
            <div><span>Scored days</span><strong>{comparison.scored_days}</strong></div>
            <div><span>Model MAE</span><strong>{euro.format(comparison.model_mae_eur_mwh)}</strong></div>
            <div><span>{comparison.baseline} MAE</span><strong>{euro.format(comparison.baseline_mae_eur_mwh)}</strong></div>
            <div><span>Running skill</span><strong data-tone={comparison.running_skill >= 0 ? "positive" : "negative"}>{signedPercent.format(comparison.running_skill)}</strong></div>
          </div>
        </DataComponent>
      )}

      <section className="record-metrics" aria-label="Running record summary">
        <RecordMetric
          id="record-status"
          queryId="ledger_status"
          title="Delivery days"
          value={`${integer.format(track.length)} scored`}
          detail={`${integer.format(missed.length)} missed · latest score ${formatDay(track.at(-1)?.date)}`}
          tone={missed.length ? "warning" : "positive"}
          rows={ledger}
        />
        <RecordMetric
          id="record-summary"
          queryId="cumulative_record"
          title="Price skill vs B1"
          value={runningSkill == null ? "—" : signedPercent.format(runningSkill)}
          detail="Running, hour-weighted · formal verdict pending"
          tone={runningSkill > 0 ? "positive" : runningSkill < 0 ? "negative" : "neutral"}
          rows={cumulative}
        />
        <RecordMetric
          id="coverage-performance"
          queryId="cumulative_record"
          title="Interval coverage"
          value={latest ? `${percent.format(latest.coverage_80)} / ${percent.format(latest.coverage_50)}` : "—"}
          detail="80% / 50% intervals · nominal values are 80% / 50%"
          rows={cumulative}
        />
        <RecordMetric
          id="negative-support"
          queryId="cumulative_record"
          title="Negative-price support"
          value={latest ? `${integer.format(latest.negative_hours)} hours` : "—"}
          detail="30-hour descriptive power condition reached; PR-AUC remains deferred"
          tone={(latest?.negative_hours ?? 0) >= 30 ? "positive" : "warning"}
          rows={cumulative}
        />
      </section>

      <section className="overview-charts" aria-label="Running forecast evidence">
        <EvidenceChart
          variant="card"
          id="price-performance"
          queryId="cumulative_record"
          title="Cumulative price error"
          description="Hour-weighted MAE since the first scored delivery day. Lower is better; these values do not constitute the pre-registered final test."
          spec={priceSpec}
          rows={cumulative}
          sourceRows={cumulative}
          height={320}
        />
        <EvidenceChart
          variant="card"
          id="coverage-trend"
          queryId="cumulative_record"
          title="Cumulative interval coverage"
          description="Empirical coverage compared with the frozen nominal levels. The final criterion is assessed only after 31 October."
          spec={coverageSpec}
          rows={coverageRows}
          sourceRows={cumulative}
          height={320}
        />
      </section>

      <DataComponent
        variant="card"
        id="integrity-summary"
        queryId="integrity"
        kind="table"
        title="What prevents a verdict today"
        description="Structural checks can pass while the prospective evidence remains incomplete."
        sourceRows={integrity}
        displayRows={warnings}
      >
        <DataTable
          rows={warnings}
          searchable={false}
          rowKey="check"
          caption="Open integrity and evaluation conditions"
          columns={[
            { key: "status", label: "State", presentation: "status" },
            { key: "check", label: "Condition" },
            { key: "evidence", label: "Evidence" },
          ]}
        />
      </DataComponent>
    </article>
  );
}

function DayDetail({ selectedDate, score, ledgerRow, hourlyRows }) {
  if (!ledgerRow) {
    return <div className="empty-detail">Select a delivery day to inspect its evidence.</div>;
  }

  if (ledgerRow.status === "MISSED") {
    return (
      <DataComponent
        variant="card"
        id="miss-detail"
        queryId="ledger_status"
        kind="custom"
        title={`${formatDay(selectedDate)} · missed`}
        description="No forecast was sealed before the auction gate, so this day cannot be backfilled."
        sourceRows={[ledgerRow]}
        displayRows={[ledgerRow]}
        className="day-detail missed-detail"
      >
        <dl className="detail-list">
          <div><dt>Recorded</dt><dd>{formatInstant(ledgerRow.recordedAtUtc)}</dd></div>
          <div><dt>Retrospective entry</dt><dd>{ledgerRow.recordedRetrospectively ? "Yes" : "No"}</dd></div>
          <div className="detail-list-wide"><dt>Failure record</dt><dd>{ledgerRow.reason}</dd></div>
        </dl>
      </DataComponent>
    );
  }

  return (
    <div className="day-detail-stack">
      <DataComponent
        variant="card"
        id="day-summary"
        queryId="track_record"
        queryIds={["track_record", "ledger_status"]}
        kind="custom"
        title={`${formatDay(selectedDate)} · scored`}
        description="Day-level outcomes, seal timing and information-cutoff checks for the selected forecast."
        sourceRowsByQuery={{ track_record: [score], ledger_status: [ledgerRow] }}
        displayRows={[score]}
        className="day-detail"
      >
        <div className="day-facts">
          <div><span>Model MAE</span><strong>{euro.format(score.maeModel)}</strong></div>
          <div><span>Skill vs B1</span><strong data-tone={score.skillVsB1 >= 0 ? "positive" : "negative"}>{signedPercent.format(score.skillVsB1)}</strong></div>
          <div><span>80% coverage</span><strong>{percent.format(score.coverage80)}</strong></div>
          <div><span>Negative hours</span><strong>{score.negativeHours}</strong></div>
        </div>
        <dl className="detail-list compact-detail-list">
          <div><dt>Sealed</dt><dd>{formatInstant(score.sealedAtUtc)}</dd></div>
          <div><dt>Auction slack</dt><dd>{decimal.format(score.minutesBeforeClose)} min</dd></div>
          <div><dt>Latest actual used</dt><dd>{formatInstant(score.latestActualUsedUtc)}</dd></div>
          <div><dt>Cutoff checks</dt><dd>{score.leakageCheckOk && score.identityCheckOk ? "Passed" : "Review required"}</dd></div>
        </dl>
      </DataComponent>

      <EvidenceChart
        variant="card"
        id="forecast-day-chart"
        queryId="hourly_outcomes"
        title="Hourly forecast and realised price"
        description="The point forecast, realised price and frozen 80% interval for the selected local power day."
        spec={hourlyPriceSpec}
        rows={hourlyRows}
        sourceRows={hourlyRows}
        scopeFilters={[{ field: "date", label: "Delivery day", value: selectedDate }]}
        height={300}
      />
    </div>
  );
}

function Ledger({ queries, activity, registration, selectedDate, setSelectedDate, ledgerMode, setLedgerMode, ledgerOrder, setLedgerOrder, ledgerBaseline, setLedgerBaseline }) {
  const track = queries.track_record.rows;
  const ledger = queries.ledger_status.rows;
  const hourly = queries.hourly_outcomes.rows;
  const scoreByDate = useMemo(() => new Map(track.map((row) => [row.date, row])), [track]);
  const enriched = useMemo(() => ledger.map((row) => ({
    ...row,
    ...scoreByDate.get(row.date),
    dateLabel: formatDay(row.date),
  })), [ledger, scoreByDate]);
  const filtered = useMemo(() => {
    const scoped = enriched.filter((row) => ledgerMode === "ALL" || row.status === ledgerMode);
    return [...scoped].sort((left, right) => {
      if (ledgerOrder === "SKILL") {
        if (left.status !== "SCORED") return 1;
        if (right.status !== "SCORED") return -1;
        const field = ledgerBaseline === "B2" ? "skillVsB2" : "skillVsB1";
        return left[field] - right[field];
      }
      if (ledgerOrder === "MODEL_MAE") {
        if (left.status !== "SCORED") return 1;
        if (right.status !== "SCORED") return -1;
        return right.maeModel - left.maeModel;
      }
      return right.date.localeCompare(left.date);
    });
  }, [enriched, ledgerMode, ledgerOrder, ledgerBaseline]);

  const selectedLedger = ledger.find((row) => row.date === selectedDate) ?? filtered[0];
  const selectedScore = scoreByDate.get(selectedLedger?.date);
  const selectedHourly = hourly.filter((row) => row.date === selectedLedger?.date);

  function chooseMode(next) {
    setLedgerMode(next);
    const candidate = enriched
      .filter((row) => next === "ALL" || row.status === next)
      .sort((left, right) => right.date.localeCompare(left.date))[0];
    if (candidate) setSelectedDate(candidate.date);
  }

  return (
    <article className="forecast-view" aria-labelledby="ledger-heading">
      <SharedFocus activity={activity} registration={registration} />
      <SectionHeader
        id="ledger-heading"
        title="Forecast ledger"
        filters={(
          <div className="ledger-controls">
            <SegmentedControl
              ariaLabel="Ledger status"
              value={ledgerMode}
              options={[
                { value: "ALL", label: "All" },
                { value: "SCORED", label: "Scored" },
                { value: "MISSED", label: "Missed" },
              ]}
              onChange={chooseMode}
            />
            <Dropdown
              label="Order"
              showLabel
              value={ledgerOrder}
              choices={["LATEST", "SKILL", "MODEL_MAE"]}
              choiceLabels={{ LATEST: "Latest first", SKILL: "Worst skill first", MODEL_MAE: "Highest model MAE" }}
              onChange={setLedgerOrder}
            />
            {ledgerOrder === "SKILL" && (
              <Dropdown
                label="Baseline"
                showLabel
                value={ledgerBaseline}
                choices={["B1", "B2"]}
                onChange={setLedgerBaseline}
              />
            )}
          </div>
        )}
      />

      <div className="ledger-workspace">
        <DataComponent
          variant="card"
          id="day-ledger"
          queryId="ledger_status"
          queryIds={["ledger_status", "track_record"]}
          kind="table"
          title="Delivery days"
          description="Every scored or missed delivery day currently present in the append-only record."
          sourceRowsByQuery={{ ledger_status: ledger, track_record: track }}
          displayRows={filtered}
          className="ledger-table-card"
        >
          <DataTable
            rows={filtered}
            searchable={false}
            rowKey="date"
            selectedRowKey={selectedLedger?.date}
            onRowSelect={(row) => setSelectedDate(row.date)}
            rowActionLabel={(row) => `Inspect ${row.date}`}
            caption="Forecast delivery-day ledger"
            columns={[
              { key: "dateLabel", label: "Delivery" },
              { key: "status", label: "State", renderCell: (value) => <StatusPill value={value} /> },
              { key: "maeModel", label: "Model MAE", renderCell: (value) => value == null ? "—" : euro.format(value) },
              { key: "maeB1", label: "B1 MAE", renderCell: (value) => value == null ? "—" : euro.format(value) },
              { key: "skillVsB1", label: "Skill vs B1", renderCell: (value) => value == null ? "—" : signedPercent.format(value) },
              { key: "coverage80", label: "80% cov.", renderCell: (value) => value == null ? "—" : percent.format(value) },
            ]}
          />
        </DataComponent>

        <DayDetail
          selectedDate={selectedLedger?.date}
          score={selectedScore}
          ledgerRow={selectedLedger}
          hourlyRows={selectedHourly}
        />
      </div>
    </article>
  );
}

function ProtocolCard({ row }) {
  return (
    <DataComponent
      variant="card"
      id={`protocol-call-${row.call.toLowerCase()}`}
      queryId="protocol"
      kind="custom"
      title={`Call ${row.call}`}
      description={row.target}
      sourceRows={[row]}
      displayRows={[row]}
      className="protocol-card"
    >
      <dl>
        <div><dt>Benchmark</dt><dd>{row.benchmark}</dd></div>
        <div><dt>Primary test</dt><dd>{row.primaryMetric}</dd></div>
        <div><dt>Success rule</dt><dd>{row.successCriterion}</dd></div>
        <div><dt>Boundary</dt><dd>{row.boundary}</dd></div>
      </dl>
      <span className="protocol-state">Formal status · pending until {formatDay(row.evaluationEnd)}</span>
    </DataComponent>
  );
}

function Protocol({ queries, activity, registration, protocolTopic, setProtocolTopic }) {
  const protocol = queries.protocol.rows;
  const provenance = queries.provenance.rows;
  const integrity = queries.integrity.rows;
  const showEvaluation = protocolTopic !== "cutoff";
  const showCutoff = protocolTopic !== "evaluation";

  return (
    <article className="forecast-view" aria-labelledby="protocol-heading">
      <SharedFocus activity={activity} registration={registration} />
      <SectionHeader
        id="protocol-heading"
        title="Protocol and provenance"
        filters={(
          <SegmentedControl
            ariaLabel="Protocol topic"
            value={protocolTopic}
            options={[
              { value: "all", label: "All" },
              { value: "evaluation", label: "Evaluation" },
              { value: "cutoff", label: "Information cutoff" },
            ]}
            onChange={setProtocolTopic}
          />
        )}
      />

      {showEvaluation && (
        <section className="protocol-grid" aria-label="Pre-registered evaluation calls">
          {protocol.map((row) => <ProtocolCard key={row.call} row={row} />)}
        </section>
      )}

      {showCutoff && (
        <DataComponent
          variant="card"
          id="data-provenance"
          queryId="provenance"
          kind="table"
          title="Information availability"
          description="What may enter a forecast, when it must have been available, and how that is evidenced."
          sourceRows={provenance}
          displayRows={provenance}
          className="protocol-table"
        >
          <DataTable
            rows={provenance}
            searchable={false}
            rowKey="source"
            caption="Forecast data provenance"
            columns={[
              { key: "source", label: "Source", presentation: "identity", secondaryField: "role" },
              { key: "availabilityRule", label: "Availability rule" },
              { key: "integrityEvidence", label: "Evidence" },
            ]}
          />
        </DataComponent>
      )}

      <DataComponent
        variant="card"
        id="integrity-register"
        queryId="integrity"
        kind="table"
        title="Integrity register"
        description="Checks over the published ledger and frozen evidence. Passing these checks is not a model-quality verdict."
        sourceRows={integrity}
        displayRows={integrity}
        className="protocol-table"
      >
        <DataTable
          rows={integrity}
          searchable={false}
          rowKey="check"
          caption="Forecast record integrity checks"
          columns={[
            { key: "status", label: "State", presentation: "status" },
            { key: "check", label: "Check" },
            { key: "evidence", label: "Evidence" },
          ]}
        />
      </DataComponent>
    </article>
  );
}

export function DashboardContent() {
  const { activeTabId } = useDashboardTabs([
    { id: "overview", label: "Track record" },
    { id: "ledger", label: "Forecast ledger" },
    { id: "protocol", label: "Protocol & provenance" },
  ]);
  const { queries, exploreDashboard } = useDataApp();
  const track = queries.track_record.rows;
  const [activity, setActivity] = useState({
    origin: "workspace",
    title: "Entire prospective record",
    detail: `${track.length} scored days, all visible misses, and no formal verdict before 31 October 2026.`,
  });
  const [selectedDate, setSelectedDate] = useState(track.at(-1)?.date ?? null);
  const [ledgerMode, setLedgerMode] = useState("ALL");
  const [ledgerOrder, setLedgerOrder] = useState("LATEST");
  const [ledgerBaseline, setLedgerBaseline] = useState("B1");
  const [protocolTopic, setProtocolTopic] = useState("all");
  const [comparison, setComparison] = useState(null);
  const registration = useForecastLedgerTools({
    queries,
    exploreDashboard,
    setActivity,
    setSelectedDate,
    setLedgerMode,
    setLedgerOrder,
    setLedgerBaseline,
    setProtocolTopic,
    setComparison,
  });
  const tab = activeTabId ?? "overview";

  return (
    <div className="forecast-ledger-page">
      {tab === "ledger" ? (
        <Ledger
          queries={queries}
          activity={activity}
          registration={registration}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          ledgerMode={ledgerMode}
          setLedgerMode={setLedgerMode}
          ledgerOrder={ledgerOrder}
          setLedgerOrder={setLedgerOrder}
          ledgerBaseline={ledgerBaseline}
          setLedgerBaseline={setLedgerBaseline}
        />
      ) : tab === "protocol" ? (
        <Protocol
          queries={queries}
          activity={activity}
          registration={registration}
          protocolTopic={protocolTopic}
          setProtocolTopic={setProtocolTopic}
        />
      ) : (
        <Overview queries={queries} activity={activity} registration={registration} comparison={comparison} />
      )}
    </div>
  );
}
