import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCollectionPlan, ingestCollectionCsv } from '../lib/core/collection.js'
import {
  AS_OF,
  assertErrorCode,
  collectionCsv,
  makeTemp,
  planFor,
  toolMap,
  writeCollection,
} from './helpers/fixtures.mjs'

const baseDir = 'unused-plan-filter-base'

test('min_amount_cents filters whole customers below their chase total', async () => {
  const plan = await planFor(toolMap(baseDir), { min_amount_cents: 20_000_000 })
  assert.deepEqual(
    plan.customers.map((customer) => customer.customer),
    ['深圳蓝海电子有限公司', '北方重工设备有限公司', '华东精密制造有限公司'],
  )
  assert.equal(plan.totals.chase_customers, 3)
  assert.equal(plan.totals.chase_invoices, 5)
  assert.equal(plan.totals.chase_amount_cents, 85_400_000)
  assert.equal(plan.totals.below_min_customers, 1)
})

test('a minimum above every balance is E_COLLECTION_EMPTY', async () => {
  await assert.rejects(
    () => planFor(toolMap(baseDir), { min_amount_cents: 1_000_000_000 }),
    (error) => assertErrorCode(error, 'E_COLLECTION_EMPTY'),
  )
})

test('include_settled adds a settled-only customer after every chase customer', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeCollection(dir, 'mixed.csv', [
    '甲公司,INV-1,2026-06-20,100000,0,a@example.com',
    '乙公司,INV-2,2026-05-01,50000,50000,b@example.com',
  ])
  const plan = await toolMap(baseDir)['collection_plan'].execute(
    { path: file, as_of: AS_OF, include_settled: true },
    { callId: 'test' },
  )
  assert.equal(plan.customers.length, 2)
  assert.equal(plan.customers[0].customer, '甲公司')
  assert.equal(plan.customers[0].stage, 'remind')
  assert.equal(plan.customers[1].customer, '乙公司')
  assert.equal(plan.customers[1].stage, 'settled')
  assert.equal(plan.customers[1].stage_label, '已结清')
  assert.equal(plan.customers[1].priority, 2)
  assert.equal(plan.customers[1].amount_cents, 0)
  assert.equal(plan.customers[1].invoice_count, 0)
  assert.equal(plan.customers[1].next_action, '无需催收')
  assert.equal(plan.customers[1].next_action_date, AS_OF)
  assert.equal(plan.totals.settled_customers, 1)
  assert.equal(plan.totals.chase_customers, 1)
})

test('include_settled keeps settled invoice counts on a customer that is still chased', async () => {
  const plan = await planFor(toolMap(baseDir), { include_settled: true })
  const lanhai = plan.customers.find((customer) => customer.customer === '深圳蓝海电子有限公司')
  assert.equal(lanhai.invoice_count, 1)
  assert.equal(lanhai.settled_invoice_count, 1)
  assert.equal(lanhai.settled_amount_cents, 5_400_000)
  assert.equal(plan.totals.settled_customers, 0)
})

test('a fully settled ledger is E_COLLECTION_EMPTY by default and a settled plan with include_settled', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeCollection(dir, 'settled.csv', [
    '甲公司,INV-1,2026-05-01,100000,100000,a@example.com',
    '乙公司,INV-2,2026-04-01,50000,50000,b@example.com',
  ])
  const tools = toolMap(baseDir)
  await assert.rejects(
    () => tools['collection_plan'].execute({ path: file, as_of: AS_OF }, { callId: 'test' }),
    (error) => assertErrorCode(error, 'E_COLLECTION_EMPTY'),
  )
  const plan = await tools['collection_plan'].execute(
    { path: file, as_of: AS_OF, include_settled: true },
    { callId: 'test' },
  )
  assert.equal(plan.customers.length, 2)
  assert.deepEqual(plan.customers.map((customer) => customer.stage), ['settled', 'settled'])
  assert.deepEqual(plan.customers.map((customer) => customer.priority), [1, 2])
})

test('open invoices before the first rung stay out of the plan but are counted', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeCollection(dir, 'early.csv', [
    '甲公司,INV-1,2026-06-01,100000,0,a@example.com',
    '甲公司,INV-2,2026-06-28,20000,0,a@example.com',
    '甲公司,INV-3,2026-07-15,30000,0,a@example.com',
  ])
  const plan = await toolMap(baseDir)['collection_plan'].execute(
    { path: file, as_of: AS_OF },
    { callId: 'test' },
  )
  assert.equal(plan.customers.length, 1)
  assert.equal(plan.customers[0].invoices.length, 1)
  assert.equal(plan.customers[0].invoices[0].invoice_no, 'INV-1')
  assert.equal(plan.totals.chase_invoices, 1)
  assert.equal(plan.totals.pre_ladder_invoices, 2)
  assert.equal(plan.totals.pre_ladder_amount_cents, 50000)
})

test('a ledger with only pre-ladder invoices is E_COLLECTION_EMPTY', () => {
  const dataset = ingestCollectionCsv(
    collectionCsv(['甲公司,INV-1,2026-06-28,100000,0,a@example.com']),
  )
  assert.throws(() => buildCollectionPlan(dataset, { asOf: AS_OF }), (error) => assertErrorCode(error, 'E_COLLECTION_EMPTY'))
})

test('a custom ladder changes which stage a customer lands in', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeCollection(dir, 'ladder.csv', ['甲公司,INV-1,2026-06-20,100000,0,a@example.com'])
  const tools = toolMap(baseDir)
  const normal = await tools['collection_plan'].execute({ path: file, as_of: AS_OF }, { callId: 'test' })
  const compressed = await tools['collection_plan'].execute(
    { path: file, as_of: AS_OF, days: [3, 5, 10] },
    { callId: 'test' },
  )
  assert.equal(normal.customers[0].stage, 'remind')
  assert.equal(compressed.customers[0].stage, 'escalate')
  assert.deepEqual(compressed.policy.ladder_days, [3, 5, 10])
})
