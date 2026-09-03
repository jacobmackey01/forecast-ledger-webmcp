# Forecast Ledger — WebMCP Challenge extension

**Live workspace:** [forecast-ledger-webmcp.jacobmackey01.chatgpt.site](https://forecast-ledger-webmcp.jacobmackey01.chatgpt.site/)  
**Source:** this repository, MIT licensed

Forecast Ledger turns a prospective electricity-market forecasting record into
a shared research-audit workspace. The browser remains useful to a human: it
shows the running track record, every scored or missed delivery day, the frozen
evaluation protocol and the information-cutoff controls. WebMCP gives an agent
structured access to those same operations. When the agent scopes a comparison,
opens a difficult day or investigates misses, the visible dashboard moves to the
same evidence.

The purpose is not to let an agent declare that a model “works.” It is to make
the evidence and the reasons for withholding that conclusion easier to inspect.
The formal assessment remains fixed for the end of the preregistered window on
31 October 2026.

## Existing project and challenge-period work

The forecasting system existed before the challenge opened on 25 August 2026.
It already contained:

- the frozen preregistration and model artefacts;
- scheduled forecast sealing and post-settlement scoring;
- write-once prediction files and an append-only ledger; and
- the deterministic prospective track-record SVG.

The WebMCP extension was added on 3 September 2026. The first extension commit
is `3a070375b1500c2560131e40e37407380d9bc1b3`. Challenge-period work comprises:

- the browser workspace under `web/`;
- a deterministic exporter that joins sealed forecasts to scored hourly
  outcomes without changing either source;
- six imperative WebMCP tools registered in the top-level page;
- shared human/agent focus state, so tool calls update the visible analysis;
- tool-contract, snapshot-reconciliation and deterministic-output tests; and
- the deployment configuration and this submission documentation.

No challenge work changes `PREREGISTRATION.md`, `models/`, `predictions/` or
`results/ledger.jsonl`.

## WebMCP tools

| Tool | Agent operation | Visible result |
|---|---|---|
| `audit_forecast_record` | Return the full running record, integrity register and formal boundary | Opens the track-record summary |
| `compare_price_baselines` | Compare hour-weighted model MAE with B1 or B2 over an optional scored date range | Shows the scoped comparison above the running charts |
| `list_worst_forecast_days` | Rank 1–10 scored days by baseline skill or model MAE | Sorts the ledger and opens the worst day |
| `inspect_missed_runs` | Return every miss and its recorded failure reason | Filters the ledger to missed days |
| `show_forecast_day` | Return seal, cutoff, daily metrics and the five largest hourly errors, or a miss record | Opens that delivery day and its hourly chart |
| `inspect_research_protocol` | Inspect the evaluation rules, source-availability rules or both; optionally bind them to one scored day | Opens the matching protocol or provenance view |

The tools update view state only. Their annotations do not claim a read-only
operation because changing the visible workspace is an intentional side effect;
the underlying research record remains unchanged.

## Example collaboration

Open the live workspace in ChatGPT's in-app browser and ask:

> Audit this forecast record. Tell me whether the running result is enough to
> support a genuine improvement claim, inspect the missed runs, then show me the
> five weakest days against the preregistered weekly persistence baseline.

A useful response should call several tools, move from the overview to the miss
register and then to the ranked ledger, and preserve the key boundary: running
skill can be encouraging while the fixed-window test is still pending and the
missed-run sequence weakens the operational record.

## Reproduce the reviewed data

From the repository root:

```bash
python -m venv .venv
.venv/Scripts/Activate.ps1
python -m pip install -e ".[dev]"
python -m de_power_live.webmcp_export --output web/src/data.json
pytest tests/test_webmcp_export.py tests/test_track_record.py tests/test_audit.py
```

The exporter uses the existing strict track-record parser, verifies that every
scored row matches a sealed prediction, joins hourly forecasts to realised
prices, and preserves the app's stable identifier on regeneration. Two runs
against the same repository state produce byte-identical JSON.

## Run the browser application

```bash
cd web
npm ci
npm test
npm run build
```

The production artifact is `web/dist/index.html`. Test WebMCP in ChatGPT's
in-app browser or in a compatible Chrome build with WebMCP enabled.

## Interpretation boundary

Forecast Ledger is a research-audit interface, not a trading system. It does
not simulate P&L, compare against the market's own expectation, repair missed
runs or evaluate the preregistered calls early. A structurally valid record can
still support a null result. That distinction is part of the product rather
than a footnote added after the model is scored.
