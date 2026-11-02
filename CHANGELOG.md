# Changelog

## 0.1.0-alpha.1 — 2026-11-02

- First public alpha of `dsh-ar-collection`.
- `collection.plan`: receivables CSV ingest, three-rung reminder ladder (default 7/15/30 days), per-customer stage (提醒/催告/升级), next action date, priority order, minimum-amount filter and optional settled-customer view.
- `collection.letters`: local Chinese collection-letter `.txt` drafts with salutation, aging summary, invoice detail table, payment deadline and contact placeholders; never sends and never uses the network.
- `collection.export`: Chinese six-column collection-list CSV under `$DSH_HOME/dsh-ar-collection/exports/` with safe-path and sha256 metadata.
- Synthetic 8-row quickstart ledger, real-output golden file, real terminal screenshot and acceptance evidence.
- Local only: no network, no model call, no upload.
