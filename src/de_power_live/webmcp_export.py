"""Build the reviewed data snapshot used by the WebMCP challenge dashboard.

The append-only ledger remains the numerical source of truth.  This module
turns that record into bounded, browser-friendly queries without introducing
new model outputs or evaluating the pre-registered calls early.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .track_record import (
    EVALUATION_END,
    LEDGER_PATH,
    REPO_ROOT,
    cumulative_points,
    load_record,
)

DEFAULT_OUTPUT_PATH = REPO_ROOT / "web" / "src" / "data.json"
PREDICTIONS_DIR = REPO_ROOT / "predictions"
PREREGISTRATION_PATH = REPO_ROOT / "PREREGISTRATION.md"
MODEL_MANIFEST_PATH = REPO_ROOT / "models" / "v1" / "MANIFEST.json"
BERLIN = ZoneInfo("Europe/Berlin")


class WebMCPExportError(ValueError):
    """Raised when the public record cannot support a truthful snapshot."""


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-standard JSON constant {value!r}")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_constant)
    except (OSError, ValueError) as exc:
        raise WebMCPExportError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise WebMCPExportError(f"{path} must contain a JSON object")
    return value


def _read_ledger_rows(path: Path) -> list[dict[str, Any]]:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise WebMCPExportError(f"cannot read ledger {path}: {exc}") from exc

    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(raw.splitlines(), start=1):
        try:
            row = json.loads(line, parse_constant=_reject_constant)
        except (TypeError, ValueError) as exc:
            raise WebMCPExportError(f"ledger line {line_number}: {exc}") from exc
        if not isinstance(row, dict):
            raise WebMCPExportError(f"ledger line {line_number} is not an object")
        rows.append(row)
    if not rows:
        raise WebMCPExportError("ledger is empty")
    return rows


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise WebMCPExportError(f"{label} must be numeric")
    number = float(value)
    if not math.isfinite(number):
        raise WebMCPExportError(f"{label} must be finite")
    return number


def _source(
    label: str,
    files: list[str],
    *,
    filters: list[str] | None = None,
    caveats: list[str] | None = None,
    metric_definitions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "label": label,
        "files": files,
        "filters": filters or [],
        "caveats": caveats or [],
        "metricDefinitions": metric_definitions or [],
    }


def _timestamp(row: dict[str, Any]) -> str | None:
    for field in ("recorded_at_utc", "scored_at_utc", "sealed_at_utc"):
        value = row.get(field)
        if isinstance(value, str):
            return value
    return None


def _iso_local_hour(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise WebMCPExportError(f"invalid hourly timestamp {value!r}") from exc
    if parsed.tzinfo is None:
        raise WebMCPExportError(f"hourly timestamp lacks a UTC offset: {value!r}")
    return parsed.astimezone(BERLIN).isoformat()


def _scored_queries(
    ledger_rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    daily_rows: list[dict[str, Any]] = []
    hourly_rows: list[dict[str, Any]] = []

    for row in ledger_rows:
        if row.get("status") != "SCORED":
            continue
        delivery_date = row["delivery_date_local"]
        call_a = row["call_a"]
        call_b = row["call_b"]
        call_c = row["call_c"]
        realised = row["realised"]
        prediction_path = PREDICTIONS_DIR / f"{delivery_date}.json"
        prediction = _read_json(prediction_path)
        if prediction.get("delivery_date_local") != delivery_date:
            raise WebMCPExportError(
                f"{prediction_path}: delivery date does not match the ledger"
            )
        if prediction.get("model_version") != row["model_version"]:
            raise WebMCPExportError(
                f"{prediction_path}: model version does not match the ledger"
            )
        if prediction.get("sealed_at_utc") != row["sealed_at_utc"]:
            raise WebMCPExportError(
                f"{prediction_path}: seal timestamp does not match the ledger"
            )

        prediction_hours = prediction.get("predictions")
        if not isinstance(prediction_hours, list) or len(prediction_hours) != row["n_hours_scored"]:
            raise WebMCPExportError(
                f"{prediction_path}: hourly predictions do not match n_hours_scored"
            )
        prediction_by_hour = {item.get("hour_utc"): item for item in prediction_hours}
        if len(prediction_by_hour) != len(prediction_hours) or None in prediction_by_hour:
            raise WebMCPExportError(f"{prediction_path}: duplicate or missing hourly keys")

        leakage_check = prediction.get("leakage_check", {})
        identity_check = prediction.get("identity_check", {})
        weather_coverage = prediction.get("weather_coverage", {})

        hourly = call_b["hours"]
        baseline_brier = sum(
            (
                _finite_number(hour["baseline_negative"], "baseline_negative")
                - int(hour["outcome_negative"])
            )
            ** 2
            for hour in hourly
        ) / len(hourly)

        daily_rows.append(
            {
                "date": delivery_date,
                "status": "SCORED",
                "modelVersion": row["model_version"],
                "hours": row["n_hours_scored"],
                "sealedAtUtc": row["sealed_at_utc"],
                "scoredAtUtc": row["scored_at_utc"],
                "informationCutoffUtc": prediction.get("information_cutoff_utc"),
                "auctionClosesUtc": prediction.get("auction_closes_utc"),
                "latestActualUsedUtc": leakage_check.get("latest_actual_used_utc"),
                "leakageCheckOk": leakage_check.get("ok") is True,
                "identityCheckOk": identity_check.get("all_ok") is True,
                "weatherSitesRequested": weather_coverage.get("sites_requested"),
                "weatherSitesReturned": weather_coverage.get("sites_returned"),
                "minutesBeforeClose": row["minutes_before_close"],
                "maeModel": call_a["mae_model"],
                "maeB1": call_a["mae_baseline_b1_lag168"],
                "maeB2": call_a["mae_baseline_b2_lag24"],
                "skillVsB1": call_a["skill_vs_b1"],
                "skillVsB2": call_a["skill_vs_b2"],
                "rmseModel": call_a["rmse_model"],
                "biasModel": call_a["bias_model"],
                "brierModel": call_b["brier"],
                "brierBaseline": round(baseline_brier, 8),
                "coverage50": call_c["coverage_50"],
                "coverage80": call_c["coverage_80"],
                "negativeHours": call_b["n_negative_hours"],
                "below10Hours": call_b.get("n_below_10_hours"),
                "meanPrice": realised["mean_price"],
                "minPrice": realised["min_price"],
                "maxPrice": realised["max_price"],
            }
        )

        for hour in hourly:
            forecast = prediction_by_hour.get(hour["hour_utc"])
            if not isinstance(forecast, dict):
                raise WebMCPExportError(
                    f"{prediction_path}: missing forecast for {hour['hour_utc']}"
                )
            model_score = _finite_number(hour["model_score"], "model_score")
            forecast_score = _finite_number(
                forecast.get("call_b_prob_negative"), "call_b_prob_negative"
            )
            if abs(model_score - forecast_score) > 1e-12:
                raise WebMCPExportError(
                    f"{prediction_path}: negative-price score disagrees with the ledger"
                )

            point = _finite_number(
                forecast.get("call_a_price_eur_mwh"), "call_a_price_eur_mwh"
            )
            realised_price = _finite_number(hour["price"], "price")
            interval_50 = forecast.get("call_c_interval_50")
            interval_80 = forecast.get("call_c_interval_80")
            if (
                not isinstance(interval_50, list)
                or len(interval_50) != 2
                or not isinstance(interval_80, list)
                or len(interval_80) != 2
            ):
                raise WebMCPExportError(f"{prediction_path}: invalid prediction intervals")
            interval_50 = [
                _finite_number(interval_50[0], "interval_50_low"),
                _finite_number(interval_50[1], "interval_50_high"),
            ]
            interval_80 = [
                _finite_number(interval_80[0], "interval_80_low"),
                _finite_number(interval_80[1], "interval_80_high"),
            ]

            hourly_rows.append(
                {
                    "date": delivery_date,
                    "hourUtc": hour["hour_utc"],
                    "hourLocal": _iso_local_hour(hour["hour_utc"]),
                    "price": realised_price,
                    "pointForecast": point,
                    "absoluteError": abs(point - realised_price),
                    "signedError": point - realised_price,
                    "interval50Low": interval_50[0],
                    "interval50High": interval_50[1],
                    "interval80Low": interval_80[0],
                    "interval80High": interval_80[1],
                    "covered50": int(interval_50[0] <= realised_price <= interval_50[1]),
                    "covered80": int(interval_80[0] <= realised_price <= interval_80[1]),
                    "modelScore": model_score,
                    "baselineNegative": hour["baseline_negative"],
                    "outcomeNegative": hour["outcome_negative"],
                    "outcomeBelow10": hour.get("outcome_below_10"),
                    "baselineBelow10": hour.get("baseline_below_10"),
                }
            )

    daily_rows.sort(key=lambda item: item["date"])
    hourly_rows.sort(key=lambda item: (item["date"], item["hourUtc"]))
    return daily_rows, hourly_rows


def _cumulative_rows(record: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for point in cumulative_points(record):
        mae_b1 = point["mae_b1"]
        mae_b2 = point["mae_b2"]
        rows.append(
            {
                **point,
                "date": point["date"].isoformat(),
                "nominal_50": 0.5,
                "nominal_80": 0.8,
                "skill_vs_b1": None if mae_b1 == 0 else 1 - point["mae_model"] / mae_b1,
                "skill_vs_b2": None if mae_b2 == 0 else 1 - point["mae_model"] / mae_b2,
            }
        )
    return rows


def _ledger_status_rows(ledger_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in ledger_rows:
        delivery_date = row["delivery_date_local"]
        reason = row.get("reason")
        result.append(
            {
                "date": delivery_date,
                "status": row["status"],
                "modelVersion": row.get("model_version"),
                "sealedAtUtc": row.get("sealed_at_utc"),
                "recordedAtUtc": row.get("recorded_at_utc") or row.get("scored_at_utc"),
                "minutesBeforeClose": row.get("minutes_before_close"),
                "reason": reason,
                "note": row.get("note"),
                "recordedRetrospectively": bool(
                    isinstance(reason, str) and "entered retrospectively" in reason
                ),
                "predictionFilePresent": (PREDICTIONS_DIR / f"{delivery_date}.json").exists(),
            }
        )
    return sorted(result, key=lambda item: item["date"])


def _protocol_rows() -> list[dict[str, Any]]:
    common = {
        "evaluationEnd": EVALUATION_END.isoformat(),
        "reportDate": "2026-11-01",
        "formalStatus": "NOT_YET_EVALUATED",
    }
    return [
        {
            **common,
            "call": "A",
            "target": "Hourly DE-LU day-ahead clearing price",
            "benchmark": "Same local hour seven days earlier (B1); D-1 persistence is secondary (B2)",
            "primaryMetric": "Pooled hourly MAE skill versus B1",
            "successCriterion": "Positive skill with a 95% delivery-day block-bootstrap interval excluding zero",
            "boundary": "Beating persistence is not evidence of tradeable edge or profitability",
        },
        {
            **common,
            "call": "B",
            "target": "Hours clearing below 0 EUR/MWh",
            "benchmark": "Frozen month-by-local-hour climatology from model v1",
            "primaryMetric": "Precision-recall AUC",
            "successCriterion": "PR-AUC improvement with a 95% bootstrap interval excluding zero",
            "boundary": "Underpowered below 30 negative hours; <10 EUR/MWh is the pre-declared ranking fallback",
        },
        {
            **common,
            "call": "C",
            "target": "Central 50% and 80% hourly price intervals",
            "benchmark": "Nominal 50% and 80% coverage",
            "primaryMetric": "Empirical hourly coverage",
            "successCriterion": "Both empirical coverages within 5 percentage points of nominal",
            "boundary": "Running coverage is descriptive until the fixed evaluation window closes",
        },
    ]


def _provenance_rows(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    artefacts = manifest.get("artefact_sha256", {})
    return [
        {
            "source": "Open-Meteo numerical weather forecasts",
            "role": "Forward wind, solar and weather drivers",
            "availabilityRule": "Must be published strictly before the forecast seal timestamp",
            "integrityEvidence": "Every prediction stores SHA-256 hashes for fetched payloads",
        },
        {
            "source": "SMARD market data",
            "role": "Historical lags, training history and post-settlement scoring",
            "availabilityRule": "SMARD D+1 forecast series are permanently banned as prediction drivers",
            "integrityEvidence": "Runtime identities verify the selected market series before use",
        },
        {
            "source": "Frozen model v1 manifest",
            "role": "Binds model version, prediction source and model artefacts",
            "availabilityRule": "A source or artefact change requires a new future-facing model version",
            "integrityEvidence": f"{len(artefacts)} model artefact hashes and one source hash are recorded",
        },
        {
            "source": "GitHub commit history",
            "role": "Public timing evidence for sealed forecasts and appended scores",
            "availabilityRule": "Predictions must be committed before 12:00 Europe/Berlin on D for D+1",
            "integrityEvidence": "Existing prediction files are write-once; ledger rows are append-only",
        },
    ]


def _integrity_rows(
    ledger_rows: list[dict[str, Any]], ledger_status: list[dict[str, Any]], manifest: dict[str, Any]
) -> list[dict[str, Any]]:
    scored = [row for row in ledger_status if row["status"] == "SCORED"]
    missed = [row for row in ledger_status if row["status"] == "MISSED"]
    missing_scored_files = [row["date"] for row in scored if not row["predictionFilePresent"]]
    backfilled_misses = [row["date"] for row in missed if row["predictionFilePresent"]]
    dates = [row["delivery_date_local"] for row in ledger_rows]
    versions = sorted({row["modelVersion"] for row in scored if row["modelVersion"]})
    manifest_version = manifest.get("model_version")

    return [
        {
            "check": "ledger_semantics",
            "status": "PASS",
            "evidence": f"{len(ledger_rows)} unique delivery-day rows passed the strict track-record parser",
        },
        {
            "check": "unique_delivery_days",
            "status": "PASS" if len(dates) == len(set(dates)) else "FAIL",
            "evidence": f"{len(set(dates))} unique dates across {len(dates)} ledger rows",
        },
        {
            "check": "scored_prediction_files",
            "status": "PASS" if not missing_scored_files else "FAIL",
            "evidence": (
                f"All {len(scored)} scored days have a sealed prediction file"
                if not missing_scored_files
                else f"Missing sealed files: {', '.join(missing_scored_files)}"
            ),
        },
        {
            "check": "missed_days_not_backfilled",
            "status": "PASS" if not backfilled_misses else "FAIL",
            "evidence": (
                f"All {len(missed)} missed days remain without a forecast file"
                if not backfilled_misses
                else f"Missed days with forecast files: {', '.join(backfilled_misses)}"
            ),
        },
        {
            "check": "model_version_binding",
            "status": "PASS" if versions == [manifest_version] else "FAIL",
            "evidence": f"Scored versions: {', '.join(versions)}; manifest: {manifest_version}",
        },
        {
            "check": "automation_continuity",
            "status": "WARNING" if missed else "PASS",
            "evidence": f"{len(missed)} missed delivery days are visible and count against the record",
        },
        {
            "check": "formal_evaluation",
            "status": "PENDING",
            "evidence": f"No success or null verdict is permitted before {EVALUATION_END.isoformat()}",
        },
    ]


def build_snapshot(
    ledger_path: Path = LEDGER_PATH,
    manifest_path: Path = MODEL_MANIFEST_PATH,
) -> dict[str, Any]:
    """Return a deterministic, reviewed dashboard snapshot."""

    # load_record performs the strict semantic validation used by the existing
    # public chart.  The raw rows below are read only after that gate passes.
    record = load_record(ledger_path)
    ledger_rows = _read_ledger_rows(ledger_path)
    manifest = _read_json(manifest_path)
    daily_rows, hourly_rows = _scored_queries(ledger_rows)
    cumulative_rows = _cumulative_rows(record)
    ledger_status = _ledger_status_rows(ledger_rows)
    protocol_rows = _protocol_rows()
    provenance_rows = _provenance_rows(manifest)
    integrity_rows = _integrity_rows(ledger_rows, ledger_status, manifest)

    timestamps = [value for value in (_timestamp(row) for row in ledger_rows) if value]
    generated_at = max(timestamps) if timestamps else record.latest_date.isoformat()

    common_caveat = (
        "Running values are descriptive. Formal assessment is fixed for the end "
        f"of the evaluation window on {EVALUATION_END.isoformat()}."
    )

    return {
        "surface": "dashboard",
        "title": "Forecast Ledger",
        "generatedAt": generated_at,
        "status": "observed",
        "filters": [],
        "queries": {
            "track_record": {
                "rows": daily_rows,
                "source": _source(
                    "Observed scored delivery days from the append-only ledger",
                    ["results/ledger.jsonl"],
                    filters=["status = SCORED"],
                    caveats=[common_caveat],
                    metric_definitions=[
                        {
                            "label": "MAE skill vs B1",
                            "definition": "1 minus model MAE divided by same-hour-last-week MAE.",
                            "formula": "1 - maeModel / maeB1",
                            "dependencies": ["maeModel", "maeB1"],
                            "componentIds": ["price-performance", "day-ledger", "record-summary"],
                            "sourceLineage": [{"files": ["results/ledger.jsonl"]}],
                        },
                        {
                            "label": "Interval coverage",
                            "definition": "Share of scored hours whose realised price fell inside the frozen interval.",
                            "componentIds": ["coverage-performance", "day-ledger", "record-summary"],
                            "sourceLineage": [{"files": ["results/ledger.jsonl"]}],
                        },
                    ],
                ),
            },
            "cumulative_record": {
                "rows": cumulative_rows,
                "source": _source(
                    "Hour-weighted cumulative metrics reconstructed from scored ledger rows",
                    ["results/ledger.jsonl", "src/de_power_live/track_record.py"],
                    filters=["status = SCORED", "weighted by n_hours_scored"],
                    caveats=[common_caveat, "Call B PR-AUC is intentionally deferred to the formal analysis."],
                ),
            },
            "ledger_status": {
                "rows": ledger_status,
                "source": _source(
                    "Complete append-only delivery-day ledger",
                    ["results/ledger.jsonl", "predictions/"],
                    caveats=["Retrospectively recorded misses remain misses and cannot be backfilled."],
                ),
            },
            "hourly_outcomes": {
                "rows": hourly_rows,
                "source": _source(
                    "Hourly realised prices and frozen negative-price scores",
                    ["results/ledger.jsonl"],
                    filters=["status = SCORED"],
                    caveats=["The <10 EUR/MWh fallback uses model scores for ranking only, not calibration."],
                ),
            },
            "protocol": {
                "rows": protocol_rows,
                "source": _source(
                    "Frozen evaluation protocol",
                    ["PREREGISTRATION.md"],
                    caveats=["The protocol was frozen before the first live prediction."],
                ),
            },
            "provenance": {
                "rows": provenance_rows,
                "source": _source(
                    "Information-cutoff and model-integrity controls",
                    ["PREREGISTRATION.md", "models/v1/MANIFEST.json", "predictions/"],
                ),
            },
            "integrity": {
                "rows": integrity_rows,
                "source": _source(
                    "Deterministic checks over the published record",
                    [
                        "results/ledger.jsonl",
                        "predictions/",
                        "models/v1/MANIFEST.json",
                        "src/de_power_live/track_record.py",
                    ],
                    caveats=["A passing structural audit is not a forecast-quality verdict."],
                ),
            },
        },
    }


def write_snapshot(
    output_path: Path = DEFAULT_OUTPUT_PATH,
    ledger_path: Path = LEDGER_PATH,
    manifest_path: Path = MODEL_MANIFEST_PATH,
) -> Path:
    snapshot = build_snapshot(ledger_path=ledger_path, manifest_path=manifest_path)
    output_path = Path(output_path)
    if output_path.exists():
        current = _read_json(output_path)
        if isinstance(current.get("id"), str) and current["id"]:
            snapshot["id"] = current["id"]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(snapshot, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return output_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=LEDGER_PATH)
    parser.add_argument("--manifest", type=Path, default=MODEL_MANIFEST_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    args = parser.parse_args(argv)
    output = write_snapshot(args.output, args.ledger, args.manifest)
    print(f"Wrote reviewed WebMCP snapshot: {output}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
