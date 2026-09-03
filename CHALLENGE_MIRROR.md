# Challenge mirror status

This repository is the submission source for Forecast Ledger, the WebMCP
extension of `jacobmackey01/de-power-live-forecast`.

The complete Git history is retained to distinguish the pre-existing
prospective forecasting system from the challenge-period work. The original
repository remains the authoritative live record and continues its scheduled
forecast sealing, scoring and integrity audit.

This mirror is intentionally read-only. Its copied `predict`, `score` and
`integrity-audit` workflows are available only for manual inspection or an
explicit owner-triggered run; none has an automatic schedule. This prevents a
second repository from creating competing predictions or ledger entries.

The browser workspace uses the reviewed snapshot committed at
`web/src/data.json`. It does not silently refresh from, write to or repair the
continuing research record.
