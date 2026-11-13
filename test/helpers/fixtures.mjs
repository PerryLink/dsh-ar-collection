import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTools } from '../../lib/plugin/tools.js'

export const HEADER = 'customer,invoice_no,due_date,amount_cents,paid_cents,contact_email'
export const CHINESE_HEADER = '客户,发票号,到期日,金额分,已收金额分,联系人邮箱'
export const AS_OF = '2026-06-30'
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const samplePath = path.join(packageRoot, 'samples', 'quickstart', 'input', 'ar-collection.csv')

export function collectionCsv(rows, header = HEADER) {
  return `${header}\n${rows.join('\n')}\n`
}

export async function makeTemp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-ar-collection-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

export async function writeTextFile(dir, name, content) {
  const file = path.join(dir, name)
  await writeFile(file, content)
  return file
}

export async function writeCollection(dir, name, rows, header = HEADER) {
  return writeTextFile(dir, name, collectionCsv(rows, header))
}

export function toolMap(baseDir) {
  return Object.fromEntries(createTools({ baseDir }).map((tool) => [tool.name, tool]))
}

export const exec = { callId: 'test' }

export function assertErrorCode(error, code) {
  assert.equal(error?.code, code, `expected ${code}, got ${error?.code}: ${error?.message}`)
  assert.match(error.message, new RegExp(`${code}`))
  assert.match(error.message, /下一步：/)
  return true
}

export async function planFor(tools, overrides = {}) {
  return tools['collection_plan'].execute({ path: samplePath, as_of: AS_OF, ...overrides }, exec)
}
