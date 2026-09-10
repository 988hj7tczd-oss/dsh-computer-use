import test from 'node:test'
import assert from 'node:assert/strict'

import { dispatchKey } from '../lib/actions.js'

const target = () => ({ pid: 42, windowId: 7 })

async function invoke(key) {
  const calls = []
  const result = await dispatchKey({ key }, { ttlMs: 1000 }, {
    resolve: target,
    call: async (tool, payload) => {
      calls.push({ tool, payload })
      return { status: 'delivered' }
    },
  })
  return { result, call: calls[0] }
}

test('bare return uses press_key with a key field', async () => {
  const { result, call } = await invoke('return')
  assert.equal(call.tool, 'press_key')
  assert.equal(call.payload.key, 'return')
  assert.equal('keys' in call.payload, false)
  assert.equal(result.ok, true)
})

test('cmd+c uses hotkey with an ordered keys array', async () => {
  const { result, call } = await invoke('cmd+c')
  assert.equal(call.tool, 'hotkey')
  assert.deepEqual(call.payload.keys, ['cmd', 'c'])
  assert.equal(result.ok, true)
})

test('ctrl+shift+p preserves modifier order', async () => {
  const { call } = await invoke('ctrl+shift+p')
  assert.deepEqual(call.payload.keys, ['ctrl', 'shift', 'p'])
})

test('command, control, and option aliases normalize to engine names', async () => {
  assert.deepEqual((await invoke('command+c')).call.payload.keys, ['cmd', 'c'])
  assert.deepEqual((await invoke('control+v')).call.payload.keys, ['ctrl', 'v'])
  assert.deepEqual((await invoke('option+tab')).call.payload.keys, ['alt', 'tab'])
})

test('structured hotkey refusal is returned as ok:false', async () => {
  const result = await dispatchKey({ key: 'ctrl+?' }, { ttlMs: 1000 }, {
    resolve: target,
    call: async (tool) => {
      assert.equal(tool, 'hotkey')
      return { effect: 'rejected', code: 'no_accelerator', reason: '没有可用的 UIA accelerator' }
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.result, /引擎拒绝/)
  assert.doesNotMatch(result.result, /按键完成/)
})

test('bare Win32 key path remains press_key based', async () => {
  const { call } = await invoke('escape')
  assert.equal(call.tool, 'press_key')
  assert.equal(call.payload.key, 'escape')
  assert.deepEqual({ pid: call.payload.pid, window_id: call.payload.window_id }, { pid: 42, window_id: 7 })
})
