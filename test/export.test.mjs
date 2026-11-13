import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseCsv } from '../lib/core/csv.js'
import { AS_OF, makeTemp, samplePath, toolMap } from './helpers/fixtures.mjs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function setup(t) {
  const dir = await makeTemp(t)
  const baseDir = path.join(dir, 'store')
  return { dir, baseDir, tools: toolMap(baseDir) }
}

test('collection_export writes the six-column collection list in priority order', async (t) => {
  const { baseDir, tools } = await setup(t)
  const result = await tools['collection_export'].execute({ path: samplePath, as_of: AS_OF }, { callId: 'test' })
  assert.equal(result.filename, 'collection-2026-06-30.csv')
  assert.equal(result.rows, 7)
  assert.equal(result.invoice_count, 7)
  assert.equal(result.settled_rows, 0)
  assert.equal(result.customer_count, 4)
  assert.equal(result.total_amount_cents, 100_800_000)
  assert.deepEqual(result.stage_counts, { remind: 2, notice: 2, escalate: 3, settled: 0 })
  assert.ok(result.path.startsWith(`${baseDir}${path.sep}exports${path.sep}`), result.path)

  const text = await readFile(result.path, 'utf8')
  assert.equal(result.sha256, sha256(text))
  assert.equal(result.bytes, Buffer.byteLength(text, 'utf8'))
  const parsed = parseCsv(text)
  assert.deepEqual(parsed.rows[0], ['客户', '票号', '到期日', '金额', '阶梯', '动作日期'])
  assert.equal(parsed.rows.length, 8)
  assert.deepEqual(parsed.rows[1], ['深圳蓝海电子有限公司', 'INV-2026-0041', '2026-05-20', '320000.00', '升级', '2026-07-07'])
  assert.deepEqual(parsed.rows[2], ['江南纺织, 苏州', 'INV-2026-0032', '2026-05-15', '88000.00', '升级', '2026-07-07'])
  assert.deepEqual(parsed.rows.at(-1), ['华东精密制造有限公司', 'INV-2026-0001', '2026-06-20', '108000.00', '提醒', '2026-07-05'])
})

test('include_settled appends settled rows with an empty action date', async (t) => {
  const { tools } = await setup(t)
  const result = await tools['collection_export'].execute(
    { path: samplePath, as_of: AS_OF, include_settled: true },
    { callId: 'test' },
  )
  assert.equal(result.rows, 8)
  assert.equal(result.invoice_count, 7)
  assert.equal(result.settled_rows, 1)
  assert.equal(result.stage_counts.settled, 1)
  const parsed = parseCsv(await readFile(result.path, 'utf8'))
  const settled = parsed.rows.find((row) => row[1] === 'INV-2026-0042')
  assert.deepEqual(settled, ['深圳蓝海电子有限公司', 'INV-2026-0042', '2026-06-01', '0.00', '已结清', ''])
})

test('a custom filename is honoured and the returned hash matches the file', async (t) => {
  const { tools } = await setup(t)
  const result = await tools['collection_export'].execute(
    { path: samplePath, as_of: AS_OF, filename: 'my-collection.csv' },
    { callId: 'test' },
  )
  assert.equal(result.filename, 'my-collection.csv')
  assert.equal(path.basename(result.path), 'my-collection.csv')
  assert.equal(result.sha256, sha256(await readFile(result.path, 'utf8')))
})

test('collection_export rejects traversal, absolute paths and unsafe names', async (t) => {
  const { tools } = await setup(t)
  for (const filename of ['../evil.csv', '../../evil.csv', '/tmp/evil.csv', 'a/b.csv', 'with space.csv', '表格.csv']) {
    await assert.rejects(
      () => tools['collection_export'].execute({ path: samplePath, as_of: AS_OF, filename }, { callId: 'test' }),
      (error) => error.code === 'E_COLLECTION_PATH_INVALID',
      filename,
    )
  }
})

test('a second export to the same file overwrites it deterministically', async (t) => {
  const { tools } = await setup(t)
  const first = await tools['collection_export'].execute({ path: samplePath, as_of: AS_OF }, { callId: 'test' })
  const second = await tools['collection_export'].execute({ path: samplePath, as_of: AS_OF }, { callId: 'test' })
  assert.equal(first.path, second.path)
  assert.equal(first.sha256, second.sha256)
})

test('min_amount_cents narrows the exported rows too', async (t) => {
  const { tools } = await setup(t)
  const result = await tools['collection_export'].execute(
    { path: samplePath, as_of: AS_OF, min_amount_cents: 20_000_000 },
    { callId: 'test' },
  )
  assert.equal(result.rows, 5)
  assert.equal(result.customer_count, 3)
  assert.equal(result.total_amount_cents, 85_400_000)
})
