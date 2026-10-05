import test from 'node:test'
import assert from 'node:assert/strict'

import { createCuaCall } from '../lib/cua.js'

const endedSessionError = new Error(
  "session has ended; this session is no longer active. Call start_session with session 'dsh-computer-use'",
)

test('restarts the configured session and retries when driver says session has ended', async () => {
  const calls = []
  let actionAttempts = 0
  const call = createCuaCall(async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'screen_observe' && actionAttempts++ === 0) throw endedSessionError
    return { ok: true }
  }, 'test-session')

  const result = await call('screen_observe', { pid: 42 })

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, [
    { tool: 'screen_observe', args: { pid: 42 } },
    { tool: 'start_session', args: { session: 'test-session' } },
    { tool: 'screen_observe', args: { pid: 42 } },
  ])
})

test('does not attempt session recovery for unrelated errors', async () => {
  const calls = []
  const call = createCuaCall(async (tool, args) => {
    calls.push({ tool, args })
    throw new Error('window not found')
  }, 'test-session')

  await assert.rejects(call('screen_observe', { pid: 42 }), /window not found/)
  assert.deepEqual(calls, [{ tool: 'screen_observe', args: { pid: 42 } }])
})
