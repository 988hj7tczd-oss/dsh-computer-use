import test from 'node:test'
import assert from 'node:assert/strict'

import { dispatchKey } from '../lib/actions.js'

const target = () => ({ pid: 42, windowId: 7 })

async function invoke(key, platform = process.platform) {
  const calls = []
  const result = await dispatchKey({ key }, { ttlMs: 1000 }, {
    platform,
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
  assert.equal(call.payload.delivery_mode, process.platform === 'win32' ? 'background' : undefined)
  assert.equal('keys' in call.payload, false)
  assert.equal(result.ok, true)
})

test('cmd+c uses hotkey with an ordered keys array', async () => {
  const { result, call } = await invoke('cmd+c')
  assert.equal(call.tool, 'hotkey')
  assert.deepEqual(call.payload.keys, ['cmd', 'c'])
  assert.equal(call.payload.delivery_mode, process.platform === 'win32' ? 'background' : undefined)
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

test('structured hotkey refused effect is also returned as ok:false', async () => {
  const result = await dispatchKey({ key: 'shift+tab' }, { ttlMs: 1000 }, {
    resolve: target,
    call: async (tool, payload) => {
      assert.equal(tool, 'hotkey')
      assert.deepEqual(payload.keys, ['shift', 'tab'])
      return { effect: 'refused', code: 'foreground_unavailable', escalation: { reason: 'target is not foreground' } }
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.result, /引擎拒绝/)
})

test('bare Win32 key path remains press_key based', async () => {
  const { call } = await invoke('escape')
  assert.equal(call.tool, 'press_key')
  assert.equal(call.payload.key, 'escape')
  assert.deepEqual({ pid: call.payload.pid, window_id: call.payload.window_id }, { pid: 42, window_id: 7 })
})

test('delivery_mode is sent only on Windows key routes', async () => {
  assert.equal((await invoke('return', 'darwin')).call.payload.delivery_mode, undefined)
  assert.equal((await invoke('return', 'win32')).call.payload.delivery_mode, 'background')
})

test('key refuses instead of falling back to desktop scope without a snapshot', async () => {
  let called = false
  await assert.rejects(
    dispatchKey({ key: 'return' }, { ttlMs: 1000 }, {
      resolve: () => { throw new Error('没有可用的观察快照') },
      call: async () => { called = true; return { status: 'delivered' } },
    }),
    /观察快照/,
  )
  assert.equal(called, false)
})

test('retries a driver-declared background failure once in the foreground', async () => {
  const calls = []
  const result = await dispatchKey({ key: 'ctrl+v' }, { ttlMs: 1000 }, {
    platform: 'win32',
    resolve: target,
    agent: { id: 'test-agent' },
    approval: { request: async ({ toolName, reason }) => {
      assert.equal(toolName, 'computer_key')
      assert.match(reason, /前台/)
      return 'allowed-once'
    } },
    call: async (tool, payload) => {
      calls.push({ tool, payload })
      if (calls.length === 1) {
        return { effect: 'suspected_noop', code: 'background_unavailable', escalation: { recommended: 'foreground' } }
      }
      return { status: 'delivered' }
    },
  })
  assert.deepEqual(calls.map((call) => call.payload.delivery_mode), ['background', 'foreground'])
  assert.deepEqual(calls.map((call) => call.tool), ['hotkey', 'hotkey'])
  assert.equal(result.ok, true)
})

test('does not retry in the foreground when approval is unavailable', async () => {
  let calls = 0
  const result = await dispatchKey({ key: 'return' }, { ttlMs: 1000 }, {
    platform: 'win32',
    resolve: target,
    call: async () => {
      calls += 1
      return { effect: 'suspected_noop', code: 'background_unavailable' }
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.ok, false)
  assert.match(result.result, /foreground_approval_required/)
})

test('does not foreground-retry after the tool execution is cancelled', async () => {
  const controller = new AbortController()
  let calls = 0
  let approvalSignal
  const result = await dispatchKey({ key: 'return' }, { ttlMs: 1000 }, {
    platform: 'win32',
    resolve: target,
    agent: { id: 'test-agent' },
    signal: controller.signal,
    approval: { request: async ({ signal }) => {
      approvalSignal = signal
      controller.abort()
      return 'cancelled'
    } },
    call: async () => {
      calls += 1
      return { effect: 'suspected_noop', code: 'background_unavailable' }
    },
  })
  assert.equal(approvalSignal, controller.signal)
  assert.equal(calls, 1)
  assert.equal(result.ok, false)
  assert.match(result.result, /foreground_approval_denied/)
})

test('does not report success if the foreground retry is still a suspected no-op', async () => {
  let calls = 0
  const result = await dispatchKey({ key: 'return' }, { ttlMs: 1000 }, {
    platform: 'win32',
    resolve: target,
    agent: { id: 'test-agent' },
    approval: { request: async () => 'allowed-once' },
    call: async () => {
      calls += 1
      return calls === 1
        ? { effect: 'suspected_noop', code: 'background_unavailable', escalation: { recommended: 'foreground' } }
        : { effect: 'suspected_noop', code: 'foreground_unavailable', reason: 'target not active' }
    },
  })
  assert.equal(calls, 2)
  assert.equal(result.ok, false)
  assert.match(result.result, /suspected_noop/)
})
