#!/usr/bin/env node
/**
 * dsh-ar-collection quickstart — validates the bundled synthetic receivables
 * ledger, builds the 2026-06-30 collection plan, drafts four Chinese letters and
 * exports the collection-list CSV.
 *
 *   node samples/quickstart/run.mjs            # human-readable summary
 *   node samples/quickstart/run.mjs --json     # the golden result on stdout
 *   node samples/quickstart/run.mjs --check    # recompute and diff against the golden file
 *
 * The golden file `expected/result.json` is the stdout of `--json`; it is a real
 * run over the committed CSV, not hand-written output.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatMoney } from '../../lib/core/money.js'
import { createTools } from '../../lib/plugin/tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const samplePath = path.join(here, 'input', 'ar-collection.csv')
const expectedPath = path.join(here, 'expected', 'result.json')
const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--json') ? 'json' : 'summary'
const AS_OF = '2026-06-30'

async function run() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-ar-collection-quickstart-'))
  const realTemp = await realpath(tempDir)
  try {
    const tools = Object.fromEntries(createTools({ baseDir: tempDir }).map((tool) => [tool.name, tool]))
    const exec = { callId: 'quickstart' }

    const plan = await tools['collection.plan'].execute(
      { path: samplePath, as_of: AS_OF, days: [7, 15, 30] },
      exec,
    )
    const lettersResult = await tools['collection.letters'].execute(
      { path: samplePath, as_of: AS_OF, days: [7, 15, 30] },
      exec,
    )
    const exported = await tools['collection.export'].execute(
      { path: samplePath, as_of: AS_OF, days: [7, 15, 30] },
      exec,
    )

    const letters = []
    for (const letter of lettersResult.letters) {
      letters.push({
        ...letter,
        path: path.relative(realTemp, letter.path).split(path.sep).join('/'),
        text: await readFile(letter.path, 'utf8'),
      })
    }
    const exportText = await readFile(exported.path, 'utf8')

    return {
      sample: 'samples/quickstart/input/ar-collection.csv',
      as_of: AS_OF,
      plan,
      letters: {
        as_of: lettersResult.as_of,
        letter_count: lettersResult.letter_count,
        total_amount_cents: lettersResult.total_amount_cents,
        letters,
      },
      exports: {
        collection: {
          ...exported,
          path: path.relative(realTemp, exported.path).split(path.sep).join('/'),
          text: exportText,
        },
      },
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function printSummary(result) {
  const { plan, letters, exports } = result
  console.log('dsh-ar-collection quickstart - synthetic receivables (not customer data)')
  console.log(
    `${plan.totals.rows} invoices / ${plan.totals.chase_customers} chase customer(s); ${plan.totals.open_invoices} open, ${plan.totals.settled_invoices} settled; chase ${plan.totals.chase_invoices} invoice(s), ${formatMoney(plan.totals.chase_amount_cents)}`,
  )
  for (const stage of plan.stages) {
    console.log(
      `stage ${stage.label}: ${stage.customer_count} customer(s), ${stage.invoice_count} invoice(s), ${formatMoney(stage.amount_cents)}`,
    )
  }
  console.log('priority:')
  for (const customer of plan.customers) {
    console.log(
      `  ${customer.priority} ${customer.customer}: ${customer.stage_label}, ${customer.invoice_count} invoice(s), ${formatMoney(customer.amount_cents)}, next ${customer.next_action_date}`,
    )
  }
  console.log('letters:')
  for (const letter of letters.letters) {
    console.log(
      `  ${letter.filename}: ${letter.customer} (${letter.stage_label}), ${formatMoney(letter.amount_cents)}, pay by ${letter.pay_by}`,
    )
  }
  console.log(
    `collection CSV ${exports.collection.path}: ${exports.collection.rows} rows, ${exports.collection.bytes} bytes, sha256 ${exports.collection.sha256.slice(0, 12)}...`,
  )
}

const result = await run()

if (mode === 'json') {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} else if (mode === 'check') {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  assert.deepEqual(result, expected)
  printSummary(result)
  console.log('golden samples/quickstart/expected/result.json matches')
  console.log('quickstart ok')
} else {
  printSummary(result)
  console.log('run with --check to compare against expected/result.json')
}
