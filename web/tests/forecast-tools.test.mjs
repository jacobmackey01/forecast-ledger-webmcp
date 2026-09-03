import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  comparePriceBaselines,
  createForecastLedgerTools,
  FORECAST_LEDGER_TOOL_NAMES,
  rankWorstDays,
} from "../src/content/dashboard/forecast-tools.js";

const snapshot = JSON.parse(await readFile(new URL("../src/data.json", import.meta.url), "utf8"));

test("registers the six intended task tools", () => {
  const tools = createForecastLedgerTools(() => ({ queries: snapshot.queries, updateView: async () => {} }));
  assert.deepEqual(tools.map((tool) => tool.name), FORECAST_LEDGER_TOOL_NAMES);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 6);
  assert.ok(tools.every((tool) => tool.inputSchema.additionalProperties === false));
});

test("price comparison uses scored-hour weights", () => {
  const rows = snapshot.queries.track_record.rows.slice(0, 2);
  const result = comparePriceBaselines(rows, { baseline: "B1" });
  const hours = rows.reduce((sum, row) => sum + row.hours, 0);
  const expectedModel = rows.reduce((sum, row) => sum + row.maeModel * row.hours, 0) / hours;
  assert.equal(result.model_mae_eur_mwh, Number(expectedModel.toFixed(4)));
  assert.equal(result.scored_hours, hours);
});

test("worst-day ranking is deterministic", () => {
  const rows = rankWorstDays(snapshot.queries.track_record.rows, { count: 5, baseline: "B1", ranking: "SKILL" });
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].skill <= row.skill));
});

test("valid tool calls update the requested visible view", async () => {
  const updates = [];
  const state = { queries: snapshot.queries, updateView: async (view) => updates.push(view) };
  const tools = createForecastLedgerTools(() => state);
  const showDay = tools.find((tool) => tool.name === "show_forecast_day");
  const result = await showDay.execute({ date: "2026-08-27" });
  assert.equal(result.status, "SCORED");
  assert.equal(updates.at(-1).tab, "ledger");
  assert.equal(updates.at(-1).selectedDate, "2026-08-27");
});

test("invalid tool input fails before changing view", async () => {
  const updates = [];
  const state = { queries: snapshot.queries, updateView: async (view) => updates.push(view) };
  const tools = createForecastLedgerTools(() => state);
  const showDay = tools.find((tool) => tool.name === "show_forecast_day");
  await assert.rejects(showDay.execute({ date: "not-a-date" }), /YYYY-MM-DD/u);
  assert.deepEqual(updates, []);
});
