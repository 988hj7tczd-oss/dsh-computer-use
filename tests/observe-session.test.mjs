import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { withSession, CUA_SESSION } from '../lib/cua.js'

test('withSession adds the configured CUA session unless explicitly overridden', () => {
  assert.deepEqual(withSession({ pid: 42 }), { session: CUA_SESSION, pid: 42 })
  assert.deepEqual(withSession({ session: 'custom', pid: 42 }), { session: 'custom', pid: 42 })
})

test('all three get_window_state paths in observe.js inject the CUA session', async () => {
  const source = await readFile(new URL('../lib/observe.js', import.meta.url), 'utf8')
  const calls = source.match(/cuaCall\(\s*['"]get_window_state['"]\s*,\s*withSession\(/g) || []
  assert.equal(calls.length, 3, 'AX observe, screenshot retry, and screen_zoom must all use withSession')
})
