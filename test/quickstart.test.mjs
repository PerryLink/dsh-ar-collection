import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { packageRoot } from './helpers/fixtures.mjs'

const expectedPath = path.join(packageRoot, 'samples', 'quickstart', 'expected', 'result.json')

test('the bundled quickstart input is a real 8-row receivables CSV', async () => {
  const text = await readFile(path.join(packageRoot, 'samples', 'quickstart', 'input', 'ar-collection.csv'), 'utf8')
  assert.ok(text.startsWith('customer,invoice_no,due_date,amount_cents,paid_cents,contact_email\n'))
  assert.ok(text.includes('"江南纺织, 苏州"'))
  assert.equal(text.split('\n').filter((line) => line.trim() !== '').length, 9)
})

test('quickstart --check reproduces the committed golden result', () => {
  const result = spawnSync(process.execPath, ['samples/quickstart/run.mjs', '--check'], {
    cwd: packageRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /stage 升级: 2 customer\(s\), 3 invoice\(s\), 474,000\.00/)
  assert.match(result.stdout, /letter-01\.txt: 深圳蓝海电子有限公司 \(升级\), 320,000\.00, pay by 2026-07-03/)
  assert.match(result.stdout, /golden samples\/quickstart\/expected\/result\.json matches/)
  assert.match(result.stdout, /quickstart ok/)
})

test('quickstart --json equals the committed golden file', async () => {
  const result = spawnSync(process.execPath, ['samples/quickstart/run.mjs', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  assert.deepEqual(JSON.parse(result.stdout), expected)
  assert.equal(expected.plan.totals.chase_amount_cents, 100_800_000)
  assert.equal(expected.plan.totals.escalate_customers, 2)
  assert.equal(expected.letters.letter_count, 4)
  assert.equal(expected.exports.collection.rows, 7)
})

test('the golden letters and CSV preserve the documented Chinese sections', async () => {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  const letter = expected.letters.letters[0]
  assert.match(letter.text, /一、账龄摘要/)
  assert.match(letter.text, /二、明细表/)
  assert.match(letter.text, /三、付款期限/)
  assert.match(letter.text, /四、联系人/)
  assert.match(expected.exports.collection.text, /^客户,票号,到期日,金额,阶梯,动作日期\n/)
  assert.match(expected.exports.collection.text, /"江南纺织, 苏州",INV-2026-0032/)
})
