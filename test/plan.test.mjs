import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { planFor, toolMap } from './helpers/fixtures.mjs'

const baseDir = path.join(os.tmpdir(), 'dsh-ar-collection-unit')

test('the bundled ledger produces the documented plan totals', async () => {
  const plan = await planFor(toolMap(baseDir))
  assert.equal(plan.as_of, '2026-06-30')
  assert.deepEqual(plan.policy, { ladder_days: [7, 15, 30], min_amount_cents: 0, include_settled: false })
  assert.equal(plan.totals.rows, 8)
  assert.equal(plan.totals.open_invoices, 7)
  assert.equal(plan.totals.settled_invoices, 1)
  assert.equal(plan.totals.chase_invoices, 7)
  assert.equal(plan.totals.chase_customers, 4)
  assert.equal(plan.totals.chase_amount_cents, 100_800_000)
  assert.equal(plan.totals.settled_customers, 0)
  assert.equal(plan.source_sha256.length, 64)
})

test('the three stages carry the documented customer, invoice and amount counts', async () => {
  const plan = await planFor(toolMap(baseDir))
  assert.deepEqual(
    plan.stages.map((stage) => [stage.key, stage.label, stage.customer_count, stage.invoice_count, stage.amount_cents]),
    [
      ['remind', '提醒', 1, 2, 20_400_000],
      ['notice', '催告', 1, 2, 33_000_000],
      ['escalate', '升级', 2, 3, 47_400_000],
    ],
  )
  assert.equal(plan.stages.reduce((sum, stage) => sum + stage.amount_cents, 0), 100_800_000)
  assert.equal(plan.stages.at(-1).max_days, null)
})

test('customers are ranked by stage severity, then amount, then days overdue', async () => {
  const plan = await planFor(toolMap(baseDir))
  assert.deepEqual(
    plan.customers.map((customer) => [customer.priority, customer.customer, customer.stage, customer.amount_cents]),
    [
      [1, '深圳蓝海电子有限公司', 'escalate', 32_000_000],
      [2, '江南纺织, 苏州', 'escalate', 15_400_000],
      [3, '北方重工设备有限公司', 'notice', 33_000_000],
      [4, '华东精密制造有限公司', 'remind', 20_400_000],
    ],
  )
  assert.deepEqual(plan.customers.map((customer) => customer.stage_label), ['升级', '升级', '催告', '提醒'])
})

test('each chase invoice carries days past due and its own next action date', async () => {
  const plan = await planFor(toolMap(baseDir))
  const huadong = plan.customers.find((customer) => customer.customer === '华东精密制造有限公司')
  assert.deepEqual(
    huadong.invoices.map((invoice) => [invoice.invoice_no, invoice.due_date, invoice.days_past_due, invoice.next_action_date]),
    [
      ['INV-2026-0002', '2026-06-18', 12, '2026-07-03'],
      ['INV-2026-0001', '2026-06-20', 10, '2026-07-05'],
    ],
  )
  assert.equal(huadong.max_days_past_due, 12)
  assert.equal(huadong.oldest_due_date, '2026-06-18')
  assert.equal(huadong.next_action_date, '2026-07-03')
  assert.equal(huadong.next_action, '发送催告提醒')
})

test('customer next action dates are the earliest invoice action date', async () => {
  const plan = await planFor(toolMap(baseDir))
  assert.deepEqual(
    plan.customers.map((customer) => [customer.customer, customer.next_action_date]),
    [
      ['深圳蓝海电子有限公司', '2026-07-07'],
      ['江南纺织, 苏州', '2026-07-07'],
      ['北方重工设备有限公司', '2026-07-08'],
      ['华东精密制造有限公司', '2026-07-03'],
    ],
  )
})

test('settled invoices are excluded from the default plan but still counted', async () => {
  const plan = await planFor(toolMap(baseDir))
  const lanhai = plan.customers.find((customer) => customer.customer === '深圳蓝海电子有限公司')
  assert.equal(lanhai.invoice_count, 1)
  assert.equal(lanhai.invoices.length, 1)
  assert.equal(lanhai.settled_invoice_count, 1)
  assert.equal(lanhai.settled_amount_cents, 5_400_000)
  assert.equal(plan.totals.settled_invoices, 1)
})

test('the contact email is carried through to the customer plan', async () => {
  const plan = await planFor(toolMap(baseDir))
  assert.equal(plan.customers.find((customer) => customer.customer === '江南纺织, 苏州').contact_email, 'ar@jiangnan.example.com')
  assert.equal(plan.customers.find((customer) => customer.customer === '深圳蓝海电子有限公司').contact_email, 'pay@lanhai.example.com')
})
