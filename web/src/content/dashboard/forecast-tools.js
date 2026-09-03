const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function objectInput(input, toolName) {
  if (input === undefined) return {};
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${toolName} input must be an object.`);
  }
  return input;
}

function dateInput(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

function enumInput(value, allowed, field, fallback) {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) throw new Error(`${field} must be one of: ${allowed.join(", ")}.`);
  return value;
}

function integerInput(value, field, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function finite(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback;
}

function rounded(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function requireQueries(state) {
  const queries = state?.queries;
  const required = [
    "track_record", "cumulative_record", "ledger_status", "hourly_outcomes",
    "protocol", "provenance", "integrity",
  ];
  if (!queries || required.some((id) => !Array.isArray(queries[id]?.rows))) {
    throw new Error("The reviewed forecast ledger is not available.");
  }
  return queries;
}

function scopedTrack(rows, startDate, endDate) {
  const start = dateInput(startDate, "start_date") ?? rows.at(0)?.date;
  const end = dateInput(endDate, "end_date") ?? rows.at(-1)?.date;
  if (!start || !end) throw new Error("No scored forecast days are available.");
  if (start > end) throw new Error("start_date must be on or before end_date.");
  const scoped = rows.filter((row) => row.date >= start && row.date <= end);
  if (!scoped.length) throw new Error(`No scored forecast days fall between ${start} and ${end}.`);
  return { start, end, rows: scoped };
}

export function comparePriceBaselines(rows, { start_date, end_date, baseline = "B1" } = {}) {
  const selectedBaseline = enumInput(baseline, ["B1", "B2"], "baseline", "B1");
  const scoped = scopedTrack(rows, start_date, end_date);
  const baselineField = selectedBaseline === "B1" ? "maeB1" : "maeB2";
  const hours = scoped.rows.reduce((sum, row) => sum + row.hours, 0);
  const modelMae = scoped.rows.reduce((sum, row) => sum + row.maeModel * row.hours, 0) / hours;
  const baselineMae = scoped.rows.reduce((sum, row) => sum + row[baselineField] * row.hours, 0) / hours;
  return {
    start_date: scoped.start,
    end_date: scoped.end,
    scored_days: scoped.rows.length,
    scored_hours: hours,
    baseline: selectedBaseline,
    model_mae_eur_mwh: rounded(modelMae),
    baseline_mae_eur_mwh: rounded(baselineMae),
    running_skill: baselineMae === 0 ? null : rounded(1 - modelMae / baselineMae),
  };
}

export function rankWorstDays(rows, { count = 5, baseline = "B1", ranking = "SKILL" } = {}) {
  const limit = integerInput(count, "count", 5, 1, 10);
  const selectedBaseline = enumInput(baseline, ["B1", "B2"], "baseline", "B1");
  const selectedRanking = enumInput(ranking, ["SKILL", "MODEL_MAE"], "ranking", "SKILL");
  const skillField = selectedBaseline === "B1" ? "skillVsB1" : "skillVsB2";
  const baselineField = selectedBaseline === "B1" ? "maeB1" : "maeB2";
  return [...rows]
    .sort((left, right) => selectedRanking === "MODEL_MAE"
      ? right.maeModel - left.maeModel
      : left[skillField] - right[skillField])
    .slice(0, limit)
    .map((row) => ({
      date: row.date,
      model_mae_eur_mwh: row.maeModel,
      baseline: selectedBaseline,
      baseline_mae_eur_mwh: row[baselineField],
      skill: row[skillField],
      coverage_80: row.coverage80,
      negative_hours: row.negativeHours,
    }));
}

export function summarizeRecord(queries) {
  const track = queries.track_record.rows;
  const cumulative = queries.cumulative_record.rows;
  const ledger = queries.ledger_status.rows;
  const integrity = queries.integrity.rows;
  const latest = cumulative.at(-1);
  const misses = ledger.filter((row) => row.status === "MISSED");
  return {
    scope: {
      first_scored_date: track.at(0)?.date ?? null,
      latest_scored_date: track.at(-1)?.date ?? null,
      evaluation_end: "2026-10-31",
      scored_days: track.length,
      scored_hours: latest?.hours ?? 0,
      missed_days: misses.length,
    },
    running_evidence: {
      price_mae_eur_mwh: rounded(latest?.mae_model),
      price_skill_vs_b1: rounded(latest?.skill_vs_b1),
      price_skill_vs_b2: rounded(latest?.skill_vs_b2),
      coverage_80: rounded(latest?.coverage_80),
      coverage_50: rounded(latest?.coverage_50),
      negative_price_hours: latest?.negative_hours ?? 0,
      below_10_eur_hours: latest?.below_10_hours ?? null,
    },
    integrity: integrity.map((row) => ({ check: row.check, status: row.status, evidence: row.evidence })),
    formal_assessment: {
      status: "PENDING",
      permitted_after: "2026-10-31",
      boundary: "Running evidence is descriptive; no success, null or trading-edge claim is warranted yet.",
    },
  };
}

function missedRuns(queries) {
  const misses = queries.ledger_status.rows.filter((row) => row.status === "MISSED")
    ;
  return {
    missed_days: misses.length,
    retrospectively_recorded_days: misses.filter((row) => row.recordedRetrospectively).length,
    runs: misses.map((row) => ({
      date: row.date,
      recorded_at_utc: row.recordedAtUtc,
      recorded_retrospectively: row.recordedRetrospectively,
      reason: row.reason,
      backfilled: row.predictionFilePresent,
    })),
    boundary: "Each missed day remains in the record and cannot be backfilled.",
  };
}

function forecastDay(queries, date) {
  const deliveryDate = dateInput(date, "date");
  if (!deliveryDate) throw new Error("date is required.");
  const ledger = queries.ledger_status.rows.find((row) => row.date === deliveryDate);
  if (!ledger) throw new Error(`No ledger row exists for ${deliveryDate}.`);
  if (ledger.status === "MISSED") {
    return {
      date: deliveryDate,
      status: "MISSED",
      reason: ledger.reason,
      recorded_at_utc: ledger.recordedAtUtc,
      recorded_retrospectively: ledger.recordedRetrospectively,
      backfilled: ledger.predictionFilePresent,
    };
  }

  const score = queries.track_record.rows.find((row) => row.date === deliveryDate);
  const hours = queries.hourly_outcomes.rows.filter((row) => row.date === deliveryDate);
  if (!score || !hours.length) throw new Error(`Scored evidence is incomplete for ${deliveryDate}.`);
  const worstHours = [...hours].sort((left, right) => right.absoluteError - left.absoluteError).slice(0, 5);
  return {
    date: deliveryDate,
    status: "SCORED",
    seal: {
      sealed_at_utc: score.sealedAtUtc,
      minutes_before_close: score.minutesBeforeClose,
      information_cutoff_utc: score.informationCutoffUtc,
      latest_actual_used_utc: score.latestActualUsedUtc,
      leakage_check_ok: score.leakageCheckOk,
      source_identity_check_ok: score.identityCheckOk,
    },
    outcomes: {
      model_mae_eur_mwh: score.maeModel,
      skill_vs_b1: score.skillVsB1,
      skill_vs_b2: score.skillVsB2,
      coverage_80: score.coverage80,
      coverage_50: score.coverage50,
      negative_hours: score.negativeHours,
      realised_price_range_eur_mwh: [score.minPrice, score.maxPrice],
    },
    worst_hourly_errors: worstHours.map((row) => ({
      hour_local: row.hourLocal,
      forecast_eur_mwh: row.pointForecast,
      realised_eur_mwh: row.price,
      absolute_error_eur_mwh: rounded(row.absoluteError),
      covered_by_80_interval: Boolean(row.covered80),
    })),
  };
}

function protocolResult(queries, topic, date) {
  const selectedTopic = enumInput(
    topic, ["ALL", "EVALUATION", "INFORMATION_CUTOFF"], "topic", "ALL",
  );
  const result = {
    topic: selectedTopic,
    formal_status: "PENDING",
    evaluation_end: "2026-10-31",
  };
  if (selectedTopic !== "INFORMATION_CUTOFF") {
    result.calls = queries.protocol.rows.map((row) => ({
      call: row.call,
      target: row.target,
      benchmark: row.benchmark,
      primary_metric: row.primaryMetric,
      success_criterion: row.successCriterion,
      boundary: row.boundary,
    }));
  }
  if (selectedTopic !== "EVALUATION") {
    result.source_rules = queries.provenance.rows.map((row) => ({
      source: row.source,
      role: row.role,
      availability_rule: row.availabilityRule,
      integrity_evidence: row.integrityEvidence,
    }));
    if (date !== undefined) {
      const day = forecastDay(queries, date);
      if (day.status !== "SCORED") {
        throw new Error(`${date} was missed, so it has no information-cutoff evidence.`);
      }
      result.selected_day = { date, ...day.seal };
    }
  }
  return result;
}

const toolAnnotations = { readOnlyHint: false, untrustedContentHint: false };

export function createForecastLedgerTools(getState) {
  async function update(view) {
    const state = getState();
    if (typeof state.updateView !== "function") throw new Error("Dashboard view controls are unavailable.");
    await state.updateView(view);
  }

  return [
    {
      name: "audit_forecast_record",
      title: "Audit forecast record",
      description: "Audit the full prospective DE-LU forecast record, expose running evidence and integrity conditions, and focus the visible dashboard on the record summary. Does not issue the deferred formal verdict.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: toolAnnotations,
      async execute(input) {
        objectInput(input, "audit_forecast_record");
        const queries = requireQueries(getState());
        const result = summarizeRecord(queries);
        await update({
          tab: "overview",
          comparison: null,
          activity: {
            title: "Full record audit",
            detail: `${result.scope.scored_days} scored days, ${result.scope.missed_days} misses; formal assessment remains pending.`,
          },
        });
        return { ...result, visible_view: "Track record · entire prospective record" };
      },
    },
    {
      name: "compare_price_baselines",
      title: "Compare price baselines",
      description: "Compare the model with a pre-registered persistence baseline over an optional scored date range and focus the visible track-record view on that comparison.",
      inputSchema: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "Optional first scored delivery date, YYYY-MM-DD." },
          end_date: { type: "string", description: "Optional last scored delivery date, YYYY-MM-DD." },
          baseline: { type: "string", enum: ["B1", "B2"], default: "B1" },
        },
        additionalProperties: false,
      },
      annotations: toolAnnotations,
      async execute(input) {
        const args = objectInput(input, "compare_price_baselines");
        const queries = requireQueries(getState());
        const result = comparePriceBaselines(queries.track_record.rows, args);
        await update({
          tab: "overview",
          comparison: result,
          activity: {
            title: `${result.baseline} comparison · ${result.start_date} to ${result.end_date}`,
            detail: `Model MAE ${result.model_mae_eur_mwh} vs ${result.baseline} ${result.baseline_mae_eur_mwh} EUR/MWh; running skill ${result.running_skill}.`,
          },
        });
        return {
          ...result,
          interpretation_boundary: "This is a descriptive range comparison, not the fixed-window bootstrap verdict.",
          visible_view: "Track record · price comparison",
        };
      },
    },
    {
      name: "list_worst_forecast_days",
      title: "List worst forecast days",
      description: "Rank the worst scored forecast days by persistence skill or model MAE, show those days first in the visible ledger, and open the worst day for inspection.",
      inputSchema: {
        type: "object",
        properties: {
          count: { type: "integer", minimum: 1, maximum: 10, default: 5 },
          baseline: { type: "string", enum: ["B1", "B2"], default: "B1" },
          ranking: { type: "string", enum: ["SKILL", "MODEL_MAE"], default: "SKILL" },
        },
        additionalProperties: false,
      },
      annotations: toolAnnotations,
      async execute(input) {
        const args = objectInput(input, "list_worst_forecast_days");
        const queries = requireQueries(getState());
        const rows = rankWorstDays(queries.track_record.rows, args);
        await update({
          tab: "ledger",
          ledgerMode: "SCORED",
          ledgerOrder: (args.ranking ?? "SKILL") === "MODEL_MAE" ? "MODEL_MAE" : "SKILL",
          ledgerBaseline: args.baseline ?? "B1",
          selectedDate: rows[0]?.date,
          activity: {
            title: `${rows.length} worst scored days`,
            detail: `Ranked by ${args.ranking ?? "SKILL"} against ${args.baseline ?? "B1"}; ${rows[0]?.date} is open.`,
          },
        });
        return { days: rows, visible_view: `Forecast ledger · ${rows[0]?.date} open` };
      },
    },
    {
      name: "inspect_missed_runs",
      title: "Inspect missed runs",
      description: "Inspect every missed forecast run, including retrospective ledger entries, and filter the visible ledger to missed days without backfilling them.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: toolAnnotations,
      async execute(input) {
        objectInput(input, "inspect_missed_runs");
        const queries = requireQueries(getState());
        const result = missedRuns(queries);
        await update({
          tab: "ledger",
          ledgerMode: "MISSED",
          ledgerOrder: "LATEST",
          selectedDate: result.runs.at(-1)?.date,
          activity: {
            title: "All missed forecast runs",
            detail: `${result.missed_days} visible misses; none is treated as a sealed forecast.`,
          },
        });
        return { ...result, visible_view: "Forecast ledger · missed days" };
      },
    },
    {
      name: "show_forecast_day",
      title: "Show forecast day",
      description: "Open one delivery day in the visible ledger and return its seal, forecast-quality and hourly error evidence, or its miss record if no forecast was sealed.",
      inputSchema: {
        type: "object",
        properties: { date: { type: "string", description: "Delivery date in YYYY-MM-DD format." } },
        required: ["date"],
        additionalProperties: false,
      },
      annotations: toolAnnotations,
      async execute(input) {
        const args = objectInput(input, "show_forecast_day");
        const queries = requireQueries(getState());
        const result = forecastDay(queries, args.date);
        await update({
          tab: "ledger",
          ledgerMode: result.status,
          ledgerOrder: "LATEST",
          selectedDate: result.date,
          activity: {
            title: `${result.date} · ${result.status.toLowerCase()}`,
            detail: result.status === "SCORED"
              ? `Day evidence and ${result.worst_hourly_errors.length} largest hourly errors are open.`
              : "The failure record is open; no forecast was backfilled.",
          },
        });
        return { ...result, visible_view: `Forecast ledger · ${result.date}` };
      },
    },
    {
      name: "inspect_research_protocol",
      title: "Inspect research protocol",
      description: "Inspect the frozen evaluation calls, information-cutoff rules, or both, optionally including the exact cutoff evidence for one scored day, and open the matching visible protocol view.",
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string", enum: ["ALL", "EVALUATION", "INFORMATION_CUTOFF"], default: "ALL" },
          date: { type: "string", description: "Optional scored delivery date for exact information-cutoff evidence." },
        },
        additionalProperties: false,
      },
      annotations: toolAnnotations,
      async execute(input) {
        const args = objectInput(input, "inspect_research_protocol");
        const queries = requireQueries(getState());
        const result = protocolResult(queries, args.topic, args.date);
        const topic = result.topic === "EVALUATION" ? "evaluation"
          : result.topic === "INFORMATION_CUTOFF" ? "cutoff" : "all";
        await update({
          tab: "protocol",
          protocolTopic: topic,
          activity: {
            title: result.topic === "ALL" ? "Frozen protocol and provenance" : result.topic.replaceAll("_", " ").toLowerCase(),
            detail: args.date ? `Exact cutoff evidence for ${args.date} is included.` : "The pre-registered boundary remains visible beside the evidence.",
          },
        });
        return { ...result, visible_view: `Protocol & provenance · ${topic}` };
      },
    },
  ];
}

export const FORECAST_LEDGER_TOOL_NAMES = [
  "audit_forecast_record",
  "compare_price_baselines",
  "list_worst_forecast_days",
  "inspect_missed_runs",
  "show_forecast_day",
  "inspect_research_protocol",
];
