import test from 'node:test'
import assert from 'node:assert/strict'

import { typeText } from '../lib/actions.js'
import { clearSnapshot } from '../lib/snapshot.js'

test('type without an element still requires a fresh snapshot', async () => {
  clearSnapshot()
  await assert.rejects(
    typeText({ text: 'safe test text' }, { ttlMs: 1000 }),
    /观察快照/,
  )
})
