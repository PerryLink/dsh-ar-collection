import test from 'node:test'
import assert from 'node:assert/strict'
import { ingestCollectionCsv } from '../lib/core/collection.js'
import {
  assertErrorCode,
  CHINESE_HEADER,
  collectionCsv,
  HEADER,
} from './helpers/fixtures.mjs'

const ROWS = [
  '甲公司,INV-1,2026-06-01,100000,20000,a@example.com',
  '乙公司,INV-2,2026-05-01,50000,0,b@example.com',
]

test('ingestCollectionCsv accepts English headers and returns totals', () => {
  const dataset = ingestCollectionCsv(collectionCsv(ROWS))
  assert.equal(dataset.rows, 2)
  assert.equal(dataset.customers.length, 2)
  assert.equal(dataset.totalCents, 150000)
  assert.equal(dataset.paidCents, 20000)
  assert.equal(dataset.outstandingCents, 130000)
  assert.equal(dataset.settledRows, 0)
  assert.equal(dataset.openRows, 2)
  assert.equal(dataset.dueDateMin, '2026-05-01')
  assert.equal(dataset.dueDateMax, '2026-06-01')
  assert.equal(dataset.sourceSha256.length, 64)
  assert.equal(dataset.invoices[0].contactEmail, 'a@example.com')
})

test('ingestCollectionCsv accepts Chinese header aliases and parentheses', () => {
  const csv = collectionCsv(ROWS, '客户,发票号,到期日,金额分,已收金额(分),联系人邮箱')
  const dataset = ingestCollectionCsv(csv)
  assert.equal(dataset.outstandingCents, 130000)
  assert.deepEqual(dataset.customers, ['乙公司', '甲公司'])
})

test('a missing email column is E_COLLECTION_CSV_ROW, but an empty email value is allowed', () => {
  assert.throws(
    () => ingestCollectionCsv(collectionCsv(ROWS, '客户,发票号,到期日,金额分,已收金额分')),
    /E_COLLECTION_CSV_ROW.*表头缺少/,
  )
  const dataset = ingestCollectionCsv(collectionCsv(['甲公司,INV-1,2026-06-01,100000,0,']))
  assert.equal(dataset.invoices[0].contactEmail, '')
})

test('ingestCollectionCsv ignores unknown extra columns but still checks the row width', () => {
  const csv = `${HEADER},notes\n甲公司,INV-1,2026-06-01,100000,0,a@example.com,hello\n`
  assert.equal(ingestCollectionCsv(csv).rows, 1)
  assert.throws(
    () => ingestCollectionCsv(`${HEADER},notes\n甲公司,INV-1,2026-06-01,100000,0,a@example.com\n`),
    (error) => assertErrorCode(error, 'E_COLLECTION_CSV_ROW'),
  )
})

test('ingestCollectionCsv rejects duplicate invoice numbers', () => {
  const csv = collectionCsv([
    '甲公司,INV-1,2026-06-01,100000,0,a@example.com',
    '乙公司,INV-1,2026-06-01,100000,0,b@example.com',
  ])
  assert.throws(() => ingestCollectionCsv(csv), /E_COLLECTION_CSV_ROW.*重复/)
})

test('ingestCollectionCsv rejects malformed contact emails', () => {
  assert.throws(
    () => ingestCollectionCsv(collectionCsv(['甲公司,INV-1,2026-06-01,100000,0,not-an-email'])),
    /E_COLLECTION_CSV_ROW.*邮箱/,
  )
})

test('ingestCollectionCsv names missing headers, an empty file and a header-only file', () => {
  assert.throws(() => ingestCollectionCsv(''), (error) => assertErrorCode(error, 'E_COLLECTION_EMPTY'))
  assert.throws(() => ingestCollectionCsv('customer,invoice_no\n甲,INV-1\n'), /E_COLLECTION_CSV_ROW.*表头缺少/)
  assert.throws(() => ingestCollectionCsv(`${HEADER}\n`), (error) => assertErrorCode(error, 'E_COLLECTION_EMPTY'))
})

test('ingestCollectionCsv rejects an empty customer and an invalid due date', () => {
  assert.throws(
    () => ingestCollectionCsv(collectionCsv([',INV-1,2026-06-01,100000,0,a@example.com'])),
    /E_COLLECTION_CSV_ROW.*客户为空/,
  )
  assert.throws(
    () => ingestCollectionCsv(collectionCsv(['甲公司,INV-1,2026-02-30,100000,0,a@example.com'])),
    (error) => assertErrorCode(error, 'E_COLLECTION_DATE_INVALID'),
  )
})

test('fully paid invoices are kept and counted as settled', () => {
  const dataset = ingestCollectionCsv(
    collectionCsv([
      '甲公司,INV-1,2026-06-01,100000,100000,a@example.com',
      '乙公司,INV-2,2026-06-01,50000,0,b@example.com',
    ]),
  )
  assert.equal(dataset.settledRows, 1)
  assert.equal(dataset.openRows, 1)
  assert.equal(dataset.outstandingCents, 50000)
})

test('a duplicate header key is rejected', () => {
  assert.throws(
    () => ingestCollectionCsv(collectionCsv(ROWS, `${HEADER},amount_cents`)),
    /E_COLLECTION_CSV_ROW.*出现了两次/,
  )
})
