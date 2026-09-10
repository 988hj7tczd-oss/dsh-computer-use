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
        return { status: 'delivered' }
      },
    })
    assert.equal(result.ok, true)
    assert.match(result.result, new RegExp(`${label}完成`))
  })
}
