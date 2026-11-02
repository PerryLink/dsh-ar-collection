import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, open, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MAX_SOURCE_BYTES, readCollectionSource } from '../lib/core/source.js'
import { assertErrorCode, makeTemp } from './helpers/fixtures.mjs'

test('readCollectionSource reads a normal UTF-8 file', async (t) => {
  const dir = await makeTemp(t)
  const file = path.join(dir, 'ok.csv')
  await writeFile(file, 'a,b\n1,2\n')
  assert.equal(await readCollectionSource(file), 'a,b\n1,2\n')
})

test('a missing path, an empty path and a directory are E_COLLECTION_PATH_INVALID', async (t) => {
  const dir = await makeTemp(t)
  await assert.rejects(() => readCollectionSource(path.join(dir, 'missing.csv')), (error) => assertErrorCode(error, 'E_COLLECTION_PATH_INVALID'))
  await assert.rejects(() => readCollectionSource('   '), (error) => assertErrorCode(error, 'E_COLLECTION_PATH_INVALID'))
  await mkdir(path.join(dir, 'folder'))
  await assert.rejects(() => readCollectionSource(path.join(dir, 'folder')), (error) => assertErrorCode(error, 'E_COLLECTION_PATH_INVALID'))
})

test('an empty file is E_COLLECTION_EMPTY', async (t) => {
  const dir = await makeTemp(t)
  const file = path.join(dir, 'empty.csv')
  await writeFile(file, '')
  await assert.rejects(() => readCollectionSource(file), (error) => assertErrorCode(error, 'E_COLLECTION_EMPTY'))
})

test('a file above the 20 MB limit is E_COLLECTION_CSV_ROW', async (t) => {
  const dir = await makeTemp(t)
  const file = path.join(dir, 'big.csv')
  const handle = await open(file, 'w')
  await handle.truncate(MAX_SOURCE_BYTES + 1)
  await handle.close()
  await assert.rejects(() => readCollectionSource(file), (error) => assertErrorCode(error, 'E_COLLECTION_CSV_ROW'))
})
