import test from 'node:test'
import assert from 'node:assert/strict'

import { click, drag, scroll } from '../lib/actions.js'
import { setSnapshot, clearSnapshot } from '../lib/snapshot.js'

const cfg = { ttlMs: 30_000 }

/** 2x 缩放的窗口快照（Wayland 合成器截图常见）。 */
function seedSnapshot(overrides = {}) {
  setSnapshot({
    at: Date.now(),
    ttlMs: cfg.ttlMs,
    pid: 42,
    windowId: 7,
    appName: 'Calculator',
    snapshotId: 's00000001',
    entries: new Map(),
    mode: 'ax',
    screenshotWidth: 720,
    screenshotHeight: 1232,
    windowBounds: { x: 813, y: 308, width: 360, height: 616 },
    ...overrides,
  })
}

/** 只记录、不外发的引擎桩：滑行也走它，避免测试碰真实桌面。 */
function recorder(responses) {
  const calls = []
  const call = async (tool, payload) => {
    calls.push({ tool, payload })
    // 光标滑行是装饰性动作，不消耗排队结果
    if (tool === 'move_cursor' || tool === 'get_cursor_position') return { ok: true }
    const next = responses.shift()
    if (next) return next
    return { status: 'delivered' }
  }
  return { call, calls }
}

const backgroundUnavailable = () => ({
  effect: 'suspected_noop',
  code: 'background_unavailable',
  escalation: { recommended: 'foreground' },
})

const approvalAllow = { request: async () => 'allowed-once' }

test.afterEach(() => clearSnapshot())

test('linux click escalates a background-only surface to foreground', async () => {
  seedSnapshot()
  const { call, calls } = recorder([backgroundUnavailable(), { effect: 'ok', route: 'global_input' }])

  const result = await click({ x: 94, y: 873 }, cfg, {
    call,
    approval: approvalAllow,
    agent: { id: 'test-agent' },
    platform: 'linux',
  })

  const clicks = calls.filter((c) => c.tool === 'click')
  assert.equal(clicks.length, 2, '应重试一次')
  assert.equal(clicks[0].payload.delivery_mode, undefined)
  assert.equal(clicks[1].payload.delivery_mode, 'foreground')
  // 两次都在窗口逻辑坐标上：截图 (94,873) → 逻辑 (47,437)
  assert.equal(clicks[1].payload.x, 47)
  assert.equal(clicks[1].payload.y, 437)
  assert.equal(result.ok, true)
})

test('linux click keeps the original error when approval is denied', async () => {
  seedSnapshot()
  const { call, calls } = recorder([backgroundUnavailable()])

  const result = await click({ x: 94, y: 873 }, cfg, {
    call,
    approval: { request: async () => 'denied' },
    agent: { id: 'test-agent' },
    platform: 'linux',
  })

  assert.equal(calls.filter((c) => c.tool === 'click').length, 1, '被拒后不得前台注入')
  assert.equal(result.ok, false)
  assert.match(result.result, /foreground_approval_denied/)
})

test('linux click refuses to escalate without an approval service', async () => {
  seedSnapshot()
  const { call, calls } = recorder([backgroundUnavailable()])

  const result = await click({ x: 10, y: 10 }, cfg, { call, platform: 'linux' })

  assert.equal(calls.filter((c) => c.tool === 'click').length, 1)
  assert.equal(result.ok, false)
  assert.match(result.result, /foreground_approval_required/)
})

test('stale capture context is refreshed once before the foreground retry', async () => {
  seedSnapshot()
  const { call, calls } = recorder([
    backgroundUnavailable(),
    { code: 'screenshot_context_missing', effect: 'refused' },
    { effect: 'ok' },
  ])

  const result = await click({ x: 94, y: 873 }, cfg, {
    call,
    approval: approvalAllow,
    agent: { id: 'test-agent' },
    platform: 'linux',
  })

  const order = calls.map((c) => c.tool).filter((t) => t !== 'move_cursor' && t !== 'get_cursor_position')
  assert.deepEqual(order, ['click', 'click', 'get_window_state', 'click'])
  assert.ok(calls.some((c) => c.tool === 'get_window_state' && c.payload.window_id === 7))
  assert.equal(result.ok, true)
})

test('darwin click does not escalate (unchanged behaviour)', async () => {
  seedSnapshot()
  const { call, calls } = recorder([backgroundUnavailable()])

  const result = await click({ x: 94, y: 873 }, cfg, {
    call,
    approval: approvalAllow,
    agent: { id: 'test-agent' },
    platform: 'darwin',
  })

  assert.equal(calls.filter((c) => c.tool === 'click').length, 1)
  assert.equal(result.ok, false)
})

test('linux drag converts both endpoints and can escalate', async () => {
  seedSnapshot()
  const { call, calls } = recorder([backgroundUnavailable(), { effect: 'ok' }])

  const result = await drag({ from_x: 100, from_y: 200, to_x: 300, to_y: 400 }, cfg, {
    call,
    approval: approvalAllow,
    agent: { id: 'test-agent' },
    platform: 'linux',
  })

  const drags = calls.filter((c) => c.tool === 'drag')
  assert.equal(drags.length, 2)
  assert.deepEqual(
    [drags[1].payload.from_x, drags[1].payload.from_y, drags[1].payload.to_x, drags[1].payload.to_y],
    [50, 100, 150, 200],
  )
  assert.equal(result.ok, true)
})

test('linux scroll targets the snapshot centre and can escalate', async () => {
  seedSnapshot()
  const { call, calls } = recorder([backgroundUnavailable(), { effect: 'ok' }])

  const result = await scroll({ direction: 'down', amount: 3 }, cfg, {
    call,
    approval: approvalAllow,
    agent: { id: 'test-agent' },
    platform: 'linux',
  })

  const scrolls = calls.filter((c) => c.tool === 'scroll')
  assert.equal(scrolls.length, 2)
  // 截图中心 (360, 616) → 逻辑 (180, 308)
  assert.equal(scrolls[1].payload.x, 180)
  assert.equal(scrolls[1].payload.y, 308)
  assert.equal(result.ok, true)
})
