import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { CollectionError, collectionErrorMessage } from '../lib/core/errors.js'
import {
  AS_OF,
  assertErrorCode,
  makeTemp,
  samplePath,
  toolMap,
  writeCollection,
} from './helpers/fixtures.mjs'

const CODES = [
  'E_COLLECTION_CSV_ROW',
  'E_COLLECTION_DATE_INVALID',
  'E_COLLECTION_AMOUNT',
  'E_COLLECTION_PATH_INVALID',
  'E_COLLECTION_EMPTY',
]

test('every stable code carries a human sentence next action and optional detail', () => {
  for (const code of CODES) {
    const message = collectionErrorMessage(code, 'detail-x')
    assert.match(message, new RegExp(`（${code}）`))
    assert.match(message, /｜下一步：/)
    assert.match(message, /｜细节：detail-x/)
  }
})

test('CollectionError exposes code, name and the formatted message', () => {
  const error = new CollectionError('E_COLLECTION_AMOUNT', 'paid > amount')
  assert.equal(error.code, 'E_COLLECTION_AMOUNT')
  assert.equal(error.name, 'CollectionError')
  assert.match(error.message, /E_COLLECTION_AMOUNT/)
  assert.match(error.message, /paid > amount/)
})

test('all five codes are reachable through the public tools', async (t) => {
  const dir = await makeTemp(t)
  const tools = toolMap(path.join(dir, 'store'))
  const callPlan = (file, extra = {}) =>
    tools['collection_plan'].execute({ path: file, as_of: AS_OF, ...extra }, { callId: 'test' })

  const badRow = await writeCollection(dir, 'bad-row.csv', [
    '甲公司,INV-1,2026-06-01,100000,0',
  ])
  const badDate = await writeCollection(dir, 'bad-date.csv', ['甲公司,INV-1,2026-13-01,100000,0,a@example.com'])
  const badAmount = await writeCollection(dir, 'bad-amount.csv', ['甲公司,INV-1,2026-06-01,100000,100001,a@example.com'])
  const empty = await writeCollection(dir, 'empty.csv', [])

  await assert.rejects(() => callPlan(badRow), (error) => assertErrorCode(error, 'E_COLLECTION_CSV_ROW'))
  await assert.rejects(() => callPlan(badDate), (error) => assertErrorCode(error, 'E_COLLECTION_DATE_INVALID'))
  await assert.rejects(() => callPlan(badAmount), (error) => assertErrorCode(error, 'E_COLLECTION_AMOUNT'))
  await assert.rejects(
    () => tools['collection_export'].execute({ path: samplePath, as_of: AS_OF, filename: '../x.csv' }, { callId: 'test' }),
    (error) => assertErrorCode(error, 'E_COLLECTION_PATH_INVALID'),
  )
  await assert.rejects(() => callPlan(empty), (error) => assertErrorCode(error, 'E_COLLECTION_EMPTY'))
})
