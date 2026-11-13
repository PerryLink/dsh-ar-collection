#!/usr/bin/env node
/**
 * Acceptance checks over the public synthetic receivables ledger. Writes
 * ACCEPTANCE.csv and evidence/<run_id>/result.json. No network, no customer data.
 *
 *   node scripts/acceptance.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/core/csv.js'
import { createTools } from '../lib/plugin/tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const sample = path.join(root, 'samples', 'quickstart', 'input', 'ar-collection.csv')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const errors = []
const AS_OF = '2026-06-30'

async function errorCode(promise) {
  try {
    await promise
    return 'NO_ERROR'
  } catch (error) {
    return error?.code ?? error?.name ?? 'UNKNOWN'
  }
}

function metric(reqId, name, threshold, actual, pass) {
  return { req_id: reqId, metric: name, threshold, actual, pass }
}

async function main() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-ar-collection-acceptance-'))
  const baseDir = path.join(tempDir, 'store')
  try {
    const tools = Object.fromEntries(createTools({ baseDir }).map((tool) => [tool.name, tool]))
    const exec = { callId: 'acceptance' }

    const plan = await tools['collection_plan'].execute({ path: sample, as_of: AS_OF }, exec)
    const letters = await tools['collection_letters'].execute({ path: sample, as_of: AS_OF }, exec)
    const exported = await tools['collection_export'].execute({ path: sample, as_of: AS_OF }, exec)
    const withSettled = await tools['collection_plan'].execute(
      { path: sample, as_of: AS_OF, include_settled: true },
      exec,
    )
    const settledExport = await tools['collection_export'].execute(
      { path: sample, as_of: AS_OF, include_settled: true, filename: 'acceptance-settled.csv' },
      exec,
    )
    const minPlan = await tools['collection_plan'].execute(
      { path: sample, as_of: AS_OF, min_amount_cents: 20_000_000 },
      exec,
    )
    const customLadder = await tools['collection_plan'].execute(
      { path: sample, as_of: AS_OF, days: [15, 30, 60] },
      exec,
    )

    const firstLetterText = readFileSync(letters.letters[0].path, 'utf8')
    const letterSections = ['一、账龄摘要', '二、明细表', '三、付款期限', '四、联系人'].every((section) =>
      firstLetterText.includes(section),
    )
    const letterSalutation = firstLetterText.includes('致：深圳蓝海电子有限公司')
    const letterPlaceholders = firstLetterText.includes('[联系人姓名]') && firstLetterText.includes('[联系电话]')
    const letterHashesOk =
      letters.letters.every((letter) => sha256(readFileSync(letter.path, 'utf8')) === letter.sha256) &&
      letters.letters.every((letter) => letter.path.startsWith(`${baseDir}${path.sep}letters${path.sep}`))

    const exportText = readFileSync(exported.path, 'utf8')
    const exportParsed = parseCsv(exportText)
    const exportHeaderOk = exportParsed.rows[0]?.join(',') === '客户,票号,到期日,金额,阶梯,动作日期'
    const exportHashOk = exported.sha256 === sha256(exportText)

    const settledText = readFileSync(settledExport.path, 'utf8')
    const settledParsed = parseCsv(settledText)
    const settledRow = settledParsed.rows.find((row) => row[1] === 'INV-2026-0042')
    const withSettledOk =
      withSettled.totals.settled_invoices === 1 &&
      settledExport.rows === 8 &&
      settledExport.settled_rows === 1 &&
      settledExport.stage_counts.settled === 1 &&
      settledRow?.[4] === '已结清' &&
      settledRow?.[5] === ''

    const nextDates = Object.fromEntries(plan.customers.map((customer) => [customer.customer, customer.next_action_date]))
    const nextDatesOk =
      nextDates['华东精密制造有限公司'] === '2026-07-03' &&
      nextDates['北方重工设备有限公司'] === '2026-07-08' &&
      nextDates['江南纺织, 苏州'] === '2026-07-07' &&
      nextDates['深圳蓝海电子有限公司'] === '2026-07-07'

    const shortName = {
      '深圳蓝海电子有限公司': 'D',
      '北方重工设备有限公司': 'B',
      '江南纺织, 苏州': 'C',
      '华东精密制造有限公司': 'A',
    }
    const priorityOrder = plan.customers.map((customer) => shortName[customer.customer] ?? customer.customer).join('/')
    const priorityAmounts = plan.customers.map((customer) => customer.amount_cents).join('/')

    const badRowFile = path.join(tempDir, 'bad-row.csv')
    writeFileSync(badRowFile, 'customer,invoice_no,due_date,amount_cents,paid_cents,contact_email\n甲,INV-1,2026-06-01,100000,0\n')
    const badDateFile = path.join(tempDir, 'bad-date.csv')
    writeFileSync(badDateFile, 'customer,invoice_no,due_date,amount_cents,paid_cents,contact_email\n甲,INV-1,2026-02-30,100000,0,a@example.com\n')
    const badAmountFile = path.join(tempDir, 'bad-amount.csv')
    writeFileSync(badAmountFile, 'customer,invoice_no,due_date,amount_cents,paid_cents,contact_email\n甲,INV-1,2026-06-01,100000,100001,a@example.com\n')
    const settledFile = path.join(tempDir, 'settled.csv')
    writeFileSync(settledFile, 'customer,invoice_no,due_date,amount_cents,paid_cents,contact_email\n甲,INV-1,2026-05-01,100000,100000,a@example.com\n')

    const badRowCode = await errorCode(
      tools['collection_plan'].execute({ path: badRowFile, as_of: AS_OF }, exec),
    )
    const badDateCode = await errorCode(
      tools['collection_plan'].execute({ path: badDateFile, as_of: AS_OF }, exec),
    )
    const badAmountCode = await errorCode(
      tools['collection_plan'].execute({ path: badAmountFile, as_of: AS_OF }, exec),
    )
    const badPathCode = await errorCode(
      tools['collection_export'].execute({ path: sample, as_of: AS_OF, filename: '../evil.csv' }, exec),
    )
    const emptyCode = await errorCode(
      tools['collection_plan'].execute({ path: settledFile, as_of: AS_OF }, exec),
    )

    const metrics = [
      metric(
        'AC-A01',
        'plan totals',
        'rows=8 open=7 settled=1 chase=7 customers=4 amount=100800000',
        `rows=${plan.totals.rows} open=${plan.totals.open_invoices} settled=${plan.totals.settled_invoices} chase=${plan.totals.chase_invoices} customers=${plan.totals.chase_customers} amount=${plan.totals.chase_amount_cents}`,
        plan.totals.rows === 8 &&
          plan.totals.open_invoices === 7 &&
          plan.totals.settled_invoices === 1 &&
          plan.totals.chase_invoices === 7 &&
          plan.totals.chase_customers === 4 &&
          plan.totals.chase_amount_cents === 100_800_000,
      ),
      metric(
        'AC-A02',
        'three ladder stages',
        'remind=1/2/20400000 notice=1/2/33000000 escalate=2/3/47400000',
        plan.stages.map((stage) => `${stage.key}=${stage.customer_count}/${stage.invoice_count}/${stage.amount_cents}`).join(' '),
        plan.stages[0]?.customer_count === 1 &&
          plan.stages[0]?.invoice_count === 2 &&
          plan.stages[0]?.amount_cents === 20_400_000 &&
          plan.stages[1]?.customer_count === 1 &&
          plan.stages[1]?.invoice_count === 2 &&
          plan.stages[1]?.amount_cents === 33_000_000 &&
          plan.stages[2]?.customer_count === 2 &&
          plan.stages[2]?.invoice_count === 3 &&
          plan.stages[2]?.amount_cents === 47_400_000,
      ),
      metric(
        'AC-A03',
        'priority order',
        'order=D/C/B/A amounts=32000000/15400000/33000000/20400000',
        `order=${priorityOrder} amounts=${priorityAmounts}`,
        priorityOrder === 'D/C/B/A' && priorityAmounts === '32000000/15400000/33000000/20400000',
      ),
      metric(
        'AC-A04',
        'next action dates',
        'A=2026-07-03 B=2026-07-08 C=2026-07-07 D=2026-07-07',
        `A=${nextDates['华东精密制造有限公司']} B=${nextDates['北方重工设备有限公司']} C=${nextDates['江南纺织, 苏州']} D=${nextDates['深圳蓝海电子有限公司']}`,
        nextDatesOk,
      ),
      metric(
        'AC-A05',
        'letter drafts',
        'count=4 sections=ok hash=ok',
        `count=${letters.letter_count} sections=${letterSections && letterSalutation ? 'ok' : 'bad'} hash=${letterHashesOk ? 'ok' : 'bad'}`,
        letters.letter_count === 4 &&
          letters.total_amount_cents === 100_800_000 &&
          letterSections &&
          letterSalutation &&
          letterPlaceholders &&
          letterHashesOk,
      ),
      metric(
        'AC-A06',
        'collection CSV',
        'rows=7 lines=8 total=100800000 header=ok',
        `rows=${exported.rows} lines=${exportParsed.rows.length} total=${exported.total_amount_cents} header=${exportHeaderOk && exportHashOk ? 'ok' : 'bad'}`,
        exported.rows === 7 &&
          exportParsed.rows.length === 8 &&
          exported.total_amount_cents === 100_800_000 &&
          exportHeaderOk &&
          exportHashOk,
      ),
      metric(
        'AC-A07',
        'include settled',
        'settled=1 export_rows=8 export_settled=1',
        `settled=${withSettled.totals.settled_invoices} export_rows=${settledExport.rows} export_settled=${settledExport.settled_rows}`,
        withSettledOk,
      ),
      metric(
        'AC-A08',
        'minimum amount filter',
        'customers=3 invoices=5 amount=85400000',
        `customers=${minPlan.totals.chase_customers} invoices=${minPlan.totals.chase_invoices} amount=${minPlan.totals.chase_amount_cents}`,
        minPlan.totals.chase_customers === 3 &&
          minPlan.totals.chase_invoices === 5 &&
          minPlan.totals.chase_amount_cents === 85_400_000,
      ),
      metric(
        'AC-A09',
        'custom ladder',
        'pre=2 pre_amount=20400000 chase=3',
        `pre=${customLadder.totals.pre_ladder_invoices} pre_amount=${customLadder.totals.pre_ladder_amount_cents} chase=${customLadder.totals.chase_customers}`,
        customLadder.policy.ladder_days.join('/') === '15/30/60' &&
          customLadder.totals.pre_ladder_invoices === 2 &&
          customLadder.totals.pre_ladder_amount_cents === 20_400_000 &&
          customLadder.totals.chase_customers === 3,
      ),
      metric('AC-A10', 'bad CSV row', 'E_COLLECTION_CSV_ROW', badRowCode, badRowCode === 'E_COLLECTION_CSV_ROW'),
      metric('AC-A11', 'invalid date', 'E_COLLECTION_DATE_INVALID', badDateCode, badDateCode === 'E_COLLECTION_DATE_INVALID'),
      metric('AC-A12', 'invalid amount', 'E_COLLECTION_AMOUNT', badAmountCode, badAmountCode === 'E_COLLECTION_AMOUNT'),
      metric('AC-A13', 'export path safety', 'E_COLLECTION_PATH_INVALID', badPathCode, badPathCode === 'E_COLLECTION_PATH_INVALID'),
      metric('AC-A14', 'empty plan', 'E_COLLECTION_EMPTY', emptyCode, emptyCode === 'E_COLLECTION_EMPTY'),
    ]

    let quickstartPass = true
    try {
      execFileSync(process.execPath, ['samples/quickstart/run.mjs', '--check'], { cwd: root, stdio: 'ignore' })
    } catch {
      quickstartPass = false
    }
    const quickstartHash = sha256(readFileSync(path.join(root, 'samples', 'quickstart', 'expected', 'result.json')))
    const quickstart = {
      req_id: 'PS1-QS01',
      metric: 'quickstart golden',
      threshold: '1/1',
      actual: quickstartPass ? '1' : '0',
      pass: quickstartPass,
      evidence_sha256: quickstartHash,
    }

    const failures = metrics.filter((item) => !item.pass)
    for (const failure of failures) errors.push(`${failure.req_id} ${failure.metric}: ${failure.actual}`)
    if (!quickstartPass) errors.push('PS1-QS01 quickstart golden failed')

    const runId = `ar-collection-${Date.now()}`
    const evidence = {
      run_id: runId,
      scope: 'AR-COLLECTION-S1',
      status: failures.length === 0 && quickstartPass ? 'pass' : 'fail',
      counted: false,
      note: 'synthetic receivables ledger only; no customer data; letters never sent',
      metrics,
      pass: failures.length === 0 && quickstartPass,
    }
    const evidenceDir = path.join(root, 'evidence', runId)
    mkdirSync(evidenceDir, { recursive: true })
    const evidenceJson = `${JSON.stringify(evidence, null, 2)}\n`
    writeFileSync(path.join(evidenceDir, 'result.json'), evidenceJson)
    const evidenceHash = sha256(evidenceJson)

    const rows = [
      ...metrics.map(
        (item) =>
          `${item.req_id},${item.metric},${item.threshold},${item.actual},scripts/acceptance.mjs,${evidenceHash},${item.pass},public/synthetic,false`,
      ),
      `${quickstart.req_id},${quickstart.metric},${quickstart.threshold},${quickstart.actual},samples/quickstart/run.mjs,${quickstart.evidence_sha256},${quickstart.pass},synthetic/quickstart,true`,
    ]
    writeFileSync(
      path.join(root, 'ACCEPTANCE.csv'),
      `req_id,metric,threshold,actual,script,evidence_sha256,pass,source,counted\n${rows.join('\n')}\n`,
    )

    if (errors.length > 0) {
      for (const error of errors) console.error(`acceptance: ${error}`)
      process.exit(1)
    }
    console.log(`acceptance ok: ${metrics.length + 1} checks`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

await main()
