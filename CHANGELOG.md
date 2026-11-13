# Changelog

## [0.2.0] — 2026-11-13

### Breaking

- **Tool names no longer contain a dot.** The three tools are now
  `collection_plan`, `collection_letters` and `collection_export`. Providers
  validate `tools[].name` against `^[a-zA-Z0-9_-]+$`; the old dotted names made
  the provider reject the entire `tools` array with `Invalid 'tools[N].name'`,
  so the plugin registered but every request that carried its tools failed.
  Minor bump because tool names are part of the 0.1.0 compatibility promise —
  update prompts, saved calls and permission rules that still use the old
  spelling by replacing the dot with an underscore. The dotted names are removed
  outright (no dual registration or deprecated alias).
- Earlier changelog entries use the new spelling, so a repository-wide search no
  longer finds dotted tool names.

### Added

- `test/tool-name-wire.test.mjs` asserts that every registered tool name matches
  `^[a-zA-Z0-9_-]+$`, contains no dot, is unique and keeps the `collection_`
  namespace.

### Changed

- `src`, `test`, the five READMEs, `TROUBLESHOOTING.md`, `docs/assets` flow
  diagrams, `samples/quickstart` and `scripts/` all use the underscore names.

## [0.1.0] — 2026-11-03

### Stable

- First non-alpha release: tool names and the CLI surface are covered by a
  compatibility promise (breaking changes require a minor bump).
- Ships a quickstart sample, a one-line prompt, a permission block and real captures.

## 0.1.0-alpha.1 — 2026-11-02

- First public alpha of `dsh-ar-collection`.
- `collection_plan`: receivables CSV ingest, three-rung reminder ladder (default 7/15/30 days), per-customer stage (提醒/催告/升级), next action date, priority order, minimum-amount filter and optional settled-customer view.
- `collection_letters`: local Chinese collection-letter `.txt` drafts with salutation, aging summary, invoice detail table, payment deadline and contact placeholders; never sends and never uses the network.
- `collection_export`: Chinese six-column collection-list CSV under `$DSH_HOME/dsh-ar-collection/exports/` with safe-path and sha256 metadata.
- Synthetic 8-row quickstart ledger, real-output golden file, real terminal screenshot and acceptance evidence.
- Local only: no network, no model call, no upload.
