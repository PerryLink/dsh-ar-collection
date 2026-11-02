import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LADDER_DAYS,
  ladderStages,
  nextActionDate,
  normalizePolicy,
  paymentDeadline,
  stageForDays,
} from '../lib/core/collection.js'
import { formatIsoDate, parseIsoDate } from '../lib/core/date.js'
import { assertErrorCode } from './helpers/fixtures.mjs'

test('normalizePolicy fills the documented defaults', () => {
  const policy = normalizePolicy({ asOf: '2026-06-30' })
  assert.deepEqual(policy.ladderDays, [...DEFAULT_LADDER_DAYS])
  assert.equal(policy.minAmountCents, 0)
  assert.equal(policy.includeSettled, false)
  assert.equal(policy.asOf, '2026-06-30')
})

test('normalizePolicy accepts a custom strictly increasing ladder', () => {
  const policy = normalizePolicy({ asOf: '2026-06-30', ladderDays: [3, 10, 45], minAmountCents: 500 })
  assert.deepEqual(policy.ladderDays, [3, 10, 45])
  assert.equal(policy.minAmountCents, 500)
})

test('normalizePolicy rejects malformed ladders as E_COLLECTION_CSV_ROW', () => {
  for (const ladderDays of [[], [7, 15], [7, 15, 30, 60], [0, 15, 30], [7, 7, 30], [30, 15, 7], [7, 15.5, 30]]) {
    assert.throws(
      () => normalizePolicy({ asOf: '2026-06-30', ladderDays }),
      (error) => assertErrorCode(error, 'E_COLLECTION_CSV_ROW'),
      JSON.stringify(ladderDays),
    )
  }
})

test('normalizePolicy rejects a negative or fractional minimum amount', () => {
  for (const minAmountCents of [-1, 1.5, Number.NaN]) {
    assert.throws(
      () => normalizePolicy({ asOf: '2026-06-30', minAmountCents }),
      (error) => assertErrorCode(error, 'E_COLLECTION_AMOUNT'),
    )
  }
})

test('normalizePolicy rejects an invalid as_of date', () => {
  assert.throws(() => normalizePolicy({ asOf: '2026-02-30' }), (error) => assertErrorCode(error, 'E_COLLECTION_DATE_INVALID'))
  assert.throws(() => normalizePolicy({}), (error) => assertErrorCode(error, 'E_COLLECTION_DATE_INVALID'))
})

test('stageForDays maps every ladder boundary to exactly one stage', () => {
  assert.equal(stageForDays(0), null)
  assert.equal(stageForDays(6), null)
  assert.equal(stageForDays(7), 'remind')
  assert.equal(stageForDays(14), 'remind')
  assert.equal(stageForDays(15), 'notice')
  assert.equal(stageForDays(29), 'notice')
  assert.equal(stageForDays(30), 'escalate')
  assert.equal(stageForDays(900), 'escalate')
})

test('ladderStages exposes the three labels and ranges', () => {
  assert.deepEqual(
    ladderStages([7, 15, 30]).map((stage) => [stage.key, stage.label, stage.minDays, stage.maxDays]),
    [
      ['remind', '提醒', 7, 14],
      ['notice', '催告', 15, 29],
      ['escalate', '升级', 30, null],
    ],
  )
})

test('nextActionDate and paymentDeadline follow the documented rules', () => {
  const asOf = parseIsoDate('2026-06-30')
  assert.equal(nextActionDate(parseIsoDate('2026-06-20'), asOf, 'remind', [7, 15, 30]), '2026-07-05')
  assert.equal(nextActionDate(parseIsoDate('2026-06-15'), asOf, 'notice', [7, 15, 30]), '2026-07-15')
  assert.equal(nextActionDate(parseIsoDate('2026-06-10'), asOf, 'escalate', [7, 15, 30]), '2026-07-07')
  assert.equal(paymentDeadline(asOf, 'remind'), '2026-07-10')
  assert.equal(paymentDeadline(asOf, 'notice'), '2026-07-07')
  assert.equal(paymentDeadline(asOf, 'escalate'), '2026-07-03')
  assert.equal(formatIsoDate(asOf), '2026-06-30')
})
