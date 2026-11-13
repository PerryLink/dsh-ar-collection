import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { createTools } from '../lib/plugin/tools.js'
import * as plugin from '../lib/plugin/index.js'

// The model wire format only accepts names matching ^[a-zA-Z0-9_-]+$.
// A dotted name (the 0.1.x style) is rejected by the provider with
// `Invalid 'tools[N].name'` and takes the whole tools array down with it, so the
// plugin registers but no request that carries the tools can succeed.
const WIRE_NAME = /^[a-zA-Z0-9_-]+$/

const EXPECTED = ['collection_plan', 'collection_letters', 'collection_export']

const assertWireNames = (names) => {
  for (const name of names) {
    assert.match(name, WIRE_NAME, `${name} would be rejected by the provider`)
    assert.ok(!name.includes('.'), `${name} must not contain a dot`)
    assert.ok(name.startsWith('collection_'), `${name} must keep the collection_ namespace`)
  }
  assert.equal(new Set(names).size, names.length, 'tool names must be unique')
  assert.deepEqual([...names].sort(), [...EXPECTED].sort())
}

test('every tool created by createTools has a valid model wire name', () => {
  const tools = createTools({ baseDir: path.join(os.tmpdir(), 'dsh-ar-collection-wire') })
  assert.equal(tools.length, EXPECTED.length)
  assertWireNames(tools.map((tool) => tool.name))
})

test('apply() registers only wire-safe tool names', async () => {
  const registered = []
  await plugin.apply({ tools: { register(tool) { registered.push(tool) } } })
  assert.equal(registered.length, EXPECTED.length)
  assertWireNames(registered.map((tool) => tool.name))
})
