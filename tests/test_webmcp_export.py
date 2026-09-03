from __future__ import annotations

import json
from pathlib import Path

from de_power_live.track_record import cumulative_points, load_record
from de_power_live.webmcp_export import build_snapshot, write_snapshot


def test_snapshot_reconciles_to_the_strict_track_record():
    snapshot = build_snapshot()
    record = load_record()
    daily = snapshot["queries"]["track_record"]["rows"]
    cumulative = snapshot["queries"]["cumulative_record"]["rows"]
    status = snapshot["queries"]["ledger_status"]["rows"]

    assert len(daily) == len(record.days)
    assert len(cumulative) == len(record.days)
    assert sum(row["status"] == "MISSED" for row in status) == record.missed_count
    assert cumulative[-1]["hours"] == record.scored_hours
    assert cumulative[-1]["negative_hours"] == record.negative_hours
    assert cumulative[-1]["below_10_hours"] == record.below_10_hours

    canonical = cumulative_points(record)[-1]
    assert cumulative[-1]["mae_model"] == canonical["mae_model"]
    assert cumulative[-1]["coverage_50"] == canonical["coverage_50"]
    assert cumulative[-1]["coverage_80"] == canonical["coverage_80"]


def test_snapshot_keeps_protocol_and_running_results_separate():
    snapshot = build_snapshot()
    protocol = snapshot["queries"]["protocol"]["rows"]
    integrity = snapshot["queries"]["integrity"]["rows"]

    assert [row["call"] for row in protocol] == ["A", "B", "C"]
    assert {row["formalStatus"] for row in protocol} == {"NOT_YET_EVALUATED"}
    formal = next(row for row in integrity if row["check"] == "formal_evaluation")
    assert formal["status"] == "PENDING"
    assert "2026-10-31" in formal["evidence"]


def test_snapshot_generation_is_byte_identical(tmp_path: Path):
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"
    write_snapshot(first)
    write_snapshot(second)

    assert first.read_bytes() == second.read_bytes()
    parsed = json.loads(first.read_text(encoding="utf-8"))
    assert parsed["title"] == "Forecast Ledger"
    assert parsed["status"] == "observed"


def test_every_scored_day_has_hourly_rows_and_a_prediction_file():
    snapshot = build_snapshot()
    daily = snapshot["queries"]["track_record"]["rows"]
    hourly = snapshot["queries"]["hourly_outcomes"]["rows"]
    status = snapshot["queries"]["ledger_status"]["rows"]

    hours_by_date: dict[str, int] = {}
    for row in hourly:
        hours_by_date[row["date"]] = hours_by_date.get(row["date"], 0) + 1

    assert all(hours_by_date[row["date"]] == row["hours"] for row in daily)
    assert all(
        row["predictionFilePresent"]
        for row in status
        if row["status"] == "SCORED"
    )
    assert all(
        not row["predictionFilePresent"]
        for row in status
        if row["status"] == "MISSED"
    )
    assert all("pointForecast" in row and "absoluteError" in row for row in hourly)
    assert all(row["covered50"] in (0, 1) and row["covered80"] in (0, 1) for row in hourly)


def test_regeneration_preserves_the_data_app_identity(tmp_path: Path):
    output = tmp_path / "data.json"
    output.write_text(
        json.dumps({"id": "dashboard:stable-test-id"}), encoding="utf-8"
    )

    write_snapshot(output)

    regenerated = json.loads(output.read_text(encoding="utf-8"))
    assert regenerated["id"] == "dashboard:stable-test-id"


def test_challenge_mirror_has_no_automatic_forecast_writers():
    root = Path(__file__).resolve().parents[1]
    assert (root / "CHALLENGE_MIRROR.md").exists()

    workflows = root / ".github" / "workflows"
    predict = (workflows / "predict.yml").read_text(encoding="utf-8")
    score = (workflows / "score.yml").read_text(encoding="utf-8")
    audit = (workflows / "integrity-audit.yml").read_text(encoding="utf-8")

    assert "schedule:" not in predict
    assert "schedule:" not in score
    assert "schedule:" not in audit
    assert "workflow_run:" not in audit
    assert "workflow_dispatch:" in predict
    assert "workflow_dispatch:" in score
    assert "workflow_dispatch:" in audit
