import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  AS_OF,
  assertErrorCode,
  makeTemp,
  samplePath,
  toolMap,
  writeCollection,
} from './helpers/fixtures.mjs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function generate(t, options = {}) {
  const dir = await makeTemp(t)
  const baseDir = path.join(dir, 'store')
  const tools = toolMap(baseDir)
  const result = await tools['collection_letters'].execute(
    { path: samplePath, as_of: AS_OF, ...options },
    { callId: 'test' },
  )
  return { dir, baseDir, tools, result }
}

test('collection_letters writes one Chinese draft per chase customer', async (t) => {
  const { baseDir, result } = await generate(t)
  assert.equal(result.as_of, AS_OF)
  assert.equal(result.letter_count, 4)
  assert.equal(result.total_amount_cents, 100_800_000)
  assert.deepEqual(
    result.letters.map((letter) => [letter.filename, letter.customer, letter.stage_label]),
    [
      ['letter-01.txt', '深圳蓝海电子有限公司', '升级'],
      ['letter-02.txt', '江南纺织, 苏州', '升级'],
      ['letter-03.txt', '北方重工设备有限公司', '催告'],
      ['letter-04.txt', '华东精密制造有限公司', '提醒'],
    ],
  )
  for (const letter of result.letters) {
    assert.ok(letter.path.startsWith(`${baseDir}${path.sep}letters${path.sep}`), letter.path)
    assert.equal(letter.sha256.length, 64)
    assert.ok(letter.bytes > 0)
  }
})

test('each letter contains salutation, aging summary, detail table, deadline and contact placeholders', async (t) => {
  const { result } = await generate(t)
  const first = result.letters[0]
  const text = await readFile(first.path, 'utf8')
  assert.match(text, /^催收函（草稿）/m)
  assert.match(text, /致：深圳蓝海电子有限公司/)
  assert.match(text, /联系人：pay@lanhai\.example\.com/)
  assert.match(text, /一、账龄摘要/)
  assert.match(text, /截至 2026-06-30，贵司共有 1 张发票逾期未付/)
  assert.match(text, /应催金额人民币 320,000\.00 元/)
  assert.match(text, /二、明细表/)
  assert.match(text, /发票号 \| 到期日 \| 逾期天数 \| 未收金额（元）/)
  assert.match(text, /INV-2026-0041 \| 2026-05-20 \| 41 \| 320,000\.00/)
  assert.match(text, /三、付款期限/)
  assert.match(text, /请于 2026-07-03 前付清上述款项/)
  assert.match(text, /四、联系人/)
  assert.match(text, /联系人：\[联系人姓名\]/)
  assert.match(text, /电话：\[联系电话\]/)
  assert.match(text, /dsh-ar-collection 在本地生成，仅为草稿/)
  assert.equal(first.sha256, sha256(text))
  assert.equal(first.bytes, Buffer.byteLength(text, 'utf8'))
  assert.equal(first.pay_by, '2026-07-03')
})

test('letters use stage-specific payment deadlines and quote a customer name with a comma', async (t) => {
  const { result } = await generate(t)
  const byCustomer = Object.fromEntries(result.letters.map((letter) => [letter.customer, letter]))
  assert.equal(byCustomer['华东精密制造有限公司'].pay_by, '2026-07-10')
  assert.equal(byCustomer['北方重工设备有限公司'].pay_by, '2026-07-07')
  assert.equal(byCustomer['深圳蓝海电子有限公司'].pay_by, '2026-07-03')
  const jiangnan = await readFile(byCustomer['江南纺织, 苏州'].path, 'utf8')
  assert.match(jiangnan, /致：江南纺织, 苏州/)
  assert.match(jiangnan, /INV-2026-0032 \| 2026-05-15 \| 46 \| 88,000\.00/)
})

test('a safe filename prefix is honoured and an unsafe one is E_COLLECTION_PATH_INVALID', async (t) => {
  const { tools } = await generate(t)
  const prefixed = await tools['collection_letters'].execute(
    { path: samplePath, as_of: AS_OF, filename_prefix: 'batch-2026' },
    { callId: 'test' },
  )
  assert.equal(prefixed.letters[0].filename, 'batch-2026-01.txt')
  for (const filename_prefix of ['../evil', 'a/b', 'with space', '表格']) {
    await assert.rejects(
      () =>
        tools['collection_letters'].execute(
          { path: samplePath, as_of: AS_OF, filename_prefix },
          { callId: 'test' },
        ),
      (error) => assertErrorCode(error, 'E_COLLECTION_PATH_INVALID'),
      filename_prefix,
    )
  }
})

test('regenerating the same letters overwrites them with identical hashes', async (t) => {
  const { tools } = await generate(t)
  const first = await tools['collection_letters'].execute({ path: samplePath, as_of: AS_OF }, { callId: 'test' })
  const second = await tools['collection_letters'].execute({ path: samplePath, as_of: AS_OF }, { callId: 'test' })
  assert.deepEqual(
    first.letters.map((letter) => [letter.filename, letter.sha256]),
    second.letters.map((letter) => [letter.filename, letter.sha256]),
  )
})

test('a fully settled ledger has no letter to generate', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeCollection(dir, 'settled.csv', [
    '甲公司,INV-1,2026-05-01,100000,100000,a@example.com',
  ])
  const tools = toolMap(path.join(dir, 'store'))
  await assert.rejects(
    () =>
      tools['collection_letters'].execute(
        { path: file, as_of: AS_OF, include_settled: true },
        { callId: 'test' },
      ),
    (error) => assertErrorCode(error, 'E_COLLECTION_EMPTY'),
  )
})
