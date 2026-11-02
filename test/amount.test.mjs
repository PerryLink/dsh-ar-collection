import test from 'node:test'
import assert from 'node:assert/strict'
import { ingestCollectionCsv } from '../lib/core/collection.js'
import { formatCents, formatMoney, parseCents } from '../lib/core/money.js'
import { assertErrorCode, collectionCsv } from './helpers/fixtures.mjs'

test('parseCents accepts integer cents with separators and spaces', () => {
  assert.equal(parseCents('128,000,00', '金额分'), 12800000)
  assert.equal(parseCents(' 1 000 ', '金额分'), 1000)
  assert.equal(parseCents('1_000', '金额分'), 1000)
  assert.equal(parseCents('0', '金额分'), 0)
})

test('parseCents rejects decimals, negatives, text and unsafe integers', () => {
  for (const value of ['12.34', '-1', 'abc', '1e6', '']) {
    assert.throws(() => parseCents(value, '金额分'), (error) => assertErrorCode(error, 'E_COLLECTION_AMOUNT'))
  }
  assert.throws(() => parseCents('9'.repeat(20), '金额分'), /E_COLLECTION_AMOUNT/)
})

test('parseCents rejects zero when the amount must be positive', () => {
  assert.throws(
    () => parseCents('0', '金额分', { allowZero: false }),
    (error) => assertErrorCode(error, 'E_COLLECTION_AMOUNT'),
  )
})

test('formatCents and formatMoney render cents deterministically', () => {
  assert.equal(formatCents(0), '0.00')
  assert.equal(formatCents(5), '0.05')
  assert.equal(formatCents(12800000), '128000.00')
  assert.equal(formatCents(-130), '-1.30')
  assert.equal(formatMoney(100800000), '1,008,000.00')
  assert.equal(formatMoney(0), '0.00')
})

test('a paid amount above the invoice amount is E_COLLECTION_AMOUNT', () => {
  const csv = collectionCsv(['甲公司,INV-1,2026-06-01,100000,100001,a@example.com'])
  assert.throws(() => ingestCollectionCsv(csv), (error) => assertErrorCode(error, 'E_COLLECTION_AMOUNT'))
})

test('a zero invoice amount is E_COLLECTION_AMOUNT', () => {
  const csv = collectionCsv(['甲公司,INV-1,2026-06-01,0,0,a@example.com'])
  assert.throws(() => ingestCollectionCsv(csv), (error) => assertErrorCode(error, 'E_COLLECTION_AMOUNT'))
})
