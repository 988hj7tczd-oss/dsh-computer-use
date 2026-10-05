import test from 'node:test'
import assert from 'node:assert/strict'

import { drag, scroll, typeText } from '../lib/actions.js'

const target = () => ({ pid: 42, windowId: 7 })
const cfg = { ttlMs: 1000 }

for (const [name, action, args, tool, label] of [
  ['computer_type', typeText, { text: 'hello' }, 'type_text', '输入'],
  ['computer_scroll', scroll, { direction: 'down', amount: 2 }, 'scroll', '滚动'],
  ['computer_drag', drag, { from_x: 1, from_y: 2, to_x: 3, to_y: 4 }, 'drag', '拖拽'],
]) {
  test(`${name} returns ok:false for a structured engine refusal`, async () => {
    const result = await action(args, cfg, {
      resolve: target,
      call: async (calledTool, payload) => {
        assert.equal(calledTool, tool)
        assert.equal(payload.pid, 42)
        assert.equal(payload.window_id, 7)
        return { effect: 'refused', code: 'foreground_unavailable', reason: 'target is not foreground' }
      },
    })
    assert.equal(result.ok, false)
    assert.match(result.result, new RegExp(`${label}被引擎拒绝`))
  })

  test(`${name} keeps a normal engine result successful`, async () => {
    const result = await action(args, cfg, {
      resolve: target,
      call: async (calledTool, payload) => {
        assert.equal(calledTool, tool)
        assert.equal(payload.pid, 42)
        assert.equal(payload.window_id, 7)
        if (tool === 'type_text') assert.equal(payload.delivery_mode, 'background')
        return { status: 'delivered' }
      },
    })
    assert.equal(result.ok, true)
    assert.match(result.result, new RegExp(`${label}完成`))
  })
}

test('computer_type retries a driver-declared background failure in the foreground', async () => {
  const calls = []
  const result = await typeText({ text: 'hello' }, cfg, {
    resolve: target,
    agent: { id: 'test-agent' },
    approval: { request: async ({ toolName, reason }) => {
      assert.equal(toolName, 'computer_type')
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
  assert.deepEqual(calls.map((call) => call.tool), ['type_text', 'type_text'])
  assert.equal(result.ok, true)
})

test('computer_type does not retry in the foreground when the user denies approval', async () => {
  const calls = []
  const result = await typeText({ text: 'hello' }, cfg, {
    resolve: target,
    agent: { id: 'test-agent' },
    approval: { request: async () => 'denied' },
    call: async (tool, payload) => {
      calls.push({ tool, payload })
      return { effect: 'suspected_noop', code: 'background_unavailable' }
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].payload.delivery_mode, 'background')
  assert.equal(result.ok, false)
  assert.match(result.result, /foreground_approval_denied/)
})
