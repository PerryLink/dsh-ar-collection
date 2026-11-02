# Evidence — dsh-ar-collection 0.1.0-alpha.1

All runs are local, over a synthetic receivables ledger. No customer data, no network call, no
model call, no letter delivery. No `git commit/push` and no `npm publish` were performed.

## Environment

- Node `v24.22.1`
- pnpm `12.15.0` (local CLI; `package.json` pins `pnpm@11.28.5`)
- TypeScript `7.0.2` (NodeNext, strict)
- Date: 2026-11-02 (Asia/Shanghai)

## Commands and results

| Command | Result |
|---|---|
| `./node_modules/.bin/tsc -p tsconfig.json` | exit 0, emits `lib/` |
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit` | exit 0 |
| `node --test test/*.test.mjs` | 83 tests, 83 pass, 0 fail |
| `node samples/quickstart/run.mjs --check` | golden `expected/result.json` matches |
| `node scripts/lint.mjs` | 11 source files, 14 test files / 83 tests, 16 published entries |
| `node scripts/gate.mjs` | lint ok, acceptance ok, 15/15 acceptance rows pass |
| `npm pack --dry-run --json` | 42 files, 238,585 bytes unpacked, no publish |

## Local Package Standard v1 score

The package is intentionally **not** added to `04-build/dsh-plugins/family.json` (not in the
family yet, so the committed roster does not count it). To verify the standard locally, the
official `04-build/dsh-plugins/scripts/score-packages.mjs` was copied to a temporary harness,
pointed at a one-item temporary family file, and run against this checkout:

```
PS1 scores: 1 packages | green 1 / yellow 0 / red 0
domain packages: 1, avg 10.0
10 green  dsh-ar-collection
gate 8: ok
```

Per-category score for `dsh-ar-collection`: `page=1 sample=2 prompt=1 expected=1 permissions=2 errors=1 evidence=2 total=10` (green; every category non-zero).

## Screenshot / golden hashes

| Artifact | SHA-256 |
|---|---|
| `docs/assets/quickstart.png` | `b3eee08a51606ef3c7f99335d4d4d78b08b30209bd23a0e6dcf4fe78bbd7b7dd` |
| `docs/assets/quickstart.log` | `749f55cd3ace30e6f8ed41ced86ae23cb5aaceeb81039acc8516802c8a36473f` |
| `samples/quickstart/expected/result.json` | `efd26f055b9c9e467f195274b1191eb84cb057ff7aa931300dee1ab7a45e79d5` |
| `ACCEPTANCE.csv` quickstart row | uses the `expected/result.json` hash above |

The screenshot was rendered by `04-build/dsh-plugins/scripts/render-capture.py` from the real
captured terminal output in `docs/assets/quickstart.log` with
`RENDER_CAPTURE_FONT=/mnt/c/Windows/Fonts/msyh.ttc`; no output text was invented.

## Error-path coverage

- `E_COLLECTION_CSV_ROW` — wrong column count, missing/duplicate header, duplicate invoice, bad email, malformed ladder, empty/oversized file.
- `E_COLLECTION_DATE_INVALID` — impossible or malformed `due_date` / `as_of`.
- `E_COLLECTION_AMOUNT` — zero/non-integer amount, paid above amount, negative/fractional minimum amount.
- `E_COLLECTION_PATH_INVALID` — missing/directory input path, unsafe export filename, traversal, absolute path, symlink re-anchor, write failure.
- `E_COLLECTION_EMPTY` — empty/header-only CSV, all settled, no customer past the first rung, all customers below the minimum amount, no letter recipients.

All five codes are exercised by `test/*.test.mjs` and by `scripts/acceptance.mjs`.

## Scope notes

- Letters are written as local `.txt` drafts only; nothing is sent and no external system is contacted.
- The 8-row sample is synthetic; names, emails and amounts are placeholders.
- `ACCEPTANCE.csv` has 15 rows: 14 fixture-backed tool checks (`counted=false`) and one
  quickstart golden row (`counted=true`).
