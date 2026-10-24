import test from 'node:test'
import assert from 'node:assert/strict'

import { parseStructured } from '../lib/cua.js'

// 驱动把"结构化拒绝"写进 stdout 并以非 0 退出。以前这种输出会被当成
// 启动失败抛出异常，前台重试分支永远走不到；现在必须解析成结果对象。

test('parses a structured refusal written to stdout', () => {
  const value = parseStructured(JSON.stringify({
    code: 'background_unavailable',
    effect: 'suspected_noop',
    escalation: { recommended: 'foreground' },
  }))
  assert.equal(value.code, 'background_unavailable')
  assert.equal(value.escalation.recommended, 'foreground')
})

test('parses a JSON array result', () => {
  assert.deepEqual(parseStructured('[{"id":1}]'), [{ id: 1 }])
})

test('ignores non-JSON stdout so real failures still throw', () => {
  assert.equal(parseStructured('cua-driver: command not found'), null)
  assert.equal(parseStructured(''), null)
  assert.equal(parseStructured('   '), null)
  assert.equal(parseStructured('null'), null)
  assert.equal(parseStructured('42'), null)
})

test('ignores truncated JSON instead of half-parsing it', () => {
  // cua.js 会把错误信息截断，截断后的 JSON 不能当作结果
  assert.equal(parseStructured('{"code": "background_unavailable", "detail": "…'), null)
})
