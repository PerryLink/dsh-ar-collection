# dsh-ar-collection quickstart

- `input/ar-collection.csv` — synthetic 8-row receivables ledger: 4 customers, one settled invoice, no customer data.
- `expected/result.json` — the real stdout of `node samples/quickstart/run.mjs --json`; it is regenerated, never hand-written.
- `run.mjs` — builds the 2026-06-30 collection plan, writes four Chinese letter drafts and exports the collection-list CSV into a temporary directory.

```sh
node samples/quickstart/run.mjs            # human-readable summary
node samples/quickstart/run.mjs --json     # golden output
node samples/quickstart/run.mjs --check    # recompute and diff against expected/result.json
```

The sample deliberately spans all three ladder stages (提醒 / 催告 / 升级), includes a quoted customer name with a comma (`"江南纺织, 苏州"`), one partial payment, and one fully settled invoice.
