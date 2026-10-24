import test from 'node:test'
import assert from 'node:assert/strict'

import { windowScale, windowLocalOf, screenPointOf } from '../lib/human.js'

// 计算器在 2x 缩放下：窗口逻辑 360x616，截图帧 720x1232。
const hidpi = {
  screenshotWidth: 720,
  screenshotHeight: 1232,
  windowBounds: { x: 813, y: 308, width: 360, height: 616 },
}

// 1x 缩放：截图帧与窗口逻辑同尺寸。
const plain = {
  screenshotWidth: 1821,
  screenshotHeight: 1126,
  windowBounds: { x: 83, y: 42, width: 1821, height: 1126 },
}

test('windowScale reads the capture/window ratio', () => {
  assert.equal(windowScale(hidpi), 2)
  assert.equal(windowScale(plain), 1)
})

test('windowScale falls back to 1 without geometry on either side', () => {
  assert.equal(windowScale(null), 1)
  assert.equal(windowScale({ screenshotWidth: 720 }), 1)
  assert.equal(windowScale({ windowBounds: { width: 360 } }), 1)
  assert.equal(windowScale({ screenshotWidth: 0, windowBounds: { width: 0 } }), 1)
})

test('windowScale never upscales when the capture is smaller than the window', () => {
  // 反向比例（截图比逻辑小）不换算，避免把点击打偏
  assert.equal(windowScale({ screenshotWidth: 180, windowBounds: { width: 360 } }), 1)
})

test('windowLocalOf converts screenshot pixels to window logical pixels', () => {
  // 截图里「7」键中心 (94, 873) → 逻辑 (47, 437)
  assert.deepEqual(windowLocalOf(94, 873, hidpi), { x: 47, y: 437 })
  // 1x 会话保持原值
  assert.deepEqual(windowLocalOf(94, 873, plain), { x: 94, y: 873 })
  // 没有快照时不换算（向后兼容旧调用）
  assert.deepEqual(windowLocalOf(94, 873, undefined), { x: 94, y: 873 })
})

test('windowLocalOf rounds to whole logical pixels', () => {
  assert.deepEqual(windowLocalOf(1, 1, hidpi), { x: 1, y: 1 })
  assert.deepEqual(windowLocalOf(3, 5, hidpi), { x: 2, y: 3 })
})

test('screenPointOf shares the click coordinate space', () => {
  assert.deepEqual(screenPointOf({ x: 94, y: 873 }, hidpi), { sx: 47, sy: 437 })
  assert.equal(screenPointOf({ x: null, y: 873 }, hidpi), null)
})

test('fractional scaling (1.5x) is handled', () => {
  const fractional = {
    screenshotWidth: 1500,
    windowBounds: { width: 1000, height: 800 },
  }
  assert.equal(windowScale(fractional), 1.5)
  assert.deepEqual(windowLocalOf(300, 450, fractional), { x: 200, y: 300 })
})
