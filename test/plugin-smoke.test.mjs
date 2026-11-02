import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as plugin from '../lib/plugin/index.js'
import { createTools } from '../lib/plugin/tools.js'
import { AS_OF, exec, samplePath } from './helpers/fixtures.mjs'

const baseDir = path.join(os.tmpdir(), 'dsh-ar-collection-smoke')

test('createTools exposes the three collection.* tools with unique names', () => {
  const tools = createTools({ baseDir })
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['collection.plan', 'collection.letters', 'collection.export'],
  )
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 3)
  for (const tool of tools) {
    assert.ok(tool.name.startsWith('collection.'))
    assert.ok(tool.description.length > 0)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
  }
})

test('resolveBaseDir defaults to $DSH_HOME/dsh-ar-collection and honours the override', () => {
  assert.equal(plugin.resolveBaseDir({ DSH_HOME: '/tmp/dsh-home' }), path.join('/tmp/dsh-home', 'dsh-ar-collection'))
  assert.equal(
    plugin.resolveBaseDir({ DSH_HOME: '/tmp/dsh-home', DSH_AR_COLLECTION_HOME: '/tmp/collection-home' }),
    '/tmp/collection-home',
  )
})

test('apply() registers all three tools and writes letters plus export under the override', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-ar-collection-apply-'))
  const previous = process.env.DSH_AR_COLLECTION_HOME
  process.env.DSH_AR_COLLECTION_HOME = dir
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_AR_COLLECTION_HOME
    else process.env.DSH_AR_COLLECTION_HOME = previous
    await rm(dir, { recursive: true, force: true })
  })

  const registered = []
  await plugin.apply({ tools: { register(tool) { registered.push(tool) } } })
  assert.equal(plugin.name, 'dsh-ar-collection')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(registered.length, 3)

  const letters = registered.find((tool) => tool.name === 'collection.letters')
  const exporter = registered.find((tool) => tool.name === 'collection.export')
  const letterResult = await letters.execute({ path: samplePath, as_of: AS_OF }, exec)
  const exportResult = await exporter.execute({ path: samplePath, as_of: AS_OF }, exec)
  assert.equal(letterResult.letter_count, 4)
  assert.ok(letterResult.letters[0].path.startsWith(`${dir}${path.sep}letters${path.sep}`))
  assert.equal(exportResult.rows, 7)
  assert.ok(exportResult.path.startsWith(`${dir}${path.sep}exports${path.sep}`))
})

test('every tool render returns exactly one text block', async () => {
  const tools = Object.fromEntries(createTools({ baseDir }).map((tool) => [tool.name, tool]))
  const plan = await tools['collection.plan'].execute({ path: samplePath, as_of: AS_OF }, exec)
  const renderedPlan = tools['collection.plan'].output.render({ path: samplePath, as_of: AS_OF }, plan)
  assert.equal(renderedPlan.length, 1)
  assert.equal(renderedPlan[0].type, 'text')
  assert.match(renderedPlan[0].text, /collection plan 2026-06-30: 4 customer\(s\) \/ 7 invoice\(s\)/)
})
