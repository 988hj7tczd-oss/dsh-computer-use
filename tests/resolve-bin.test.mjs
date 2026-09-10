import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveBin } from '../lib/cua.js'

const noFiles = () => false

test('resolveBin prefers explicit CUA_DRIVER_BIN', () => {
  const result = resolveBin({
    platform: 'win32',
    env: { CUA_DRIVER_BIN: 'C:\\custom\\cua-driver.exe', PATH: '' },
    home: 'C:\\Users\\tester',
    exists: noFiles,
  })
  assert.equal(result, 'C:\\custom\\cua-driver.exe')
})

test('resolveBin finds a driver on PATH', () => {
  const result = resolveBin({
    platform: 'darwin',
    env: { PATH: '/usr/bin:/custom/bin' },
    home: '/Users/tester',
    exists: (path) => path === '/custom/bin/cua-driver',
  })
  assert.equal(result, '/custom/bin/cua-driver')
})

test('resolveBin finds the official Windows installer layout', () => {
  const official = 'C:\\Users\\tester\\.cua-driver\\packages\\current\\cua-driver.exe'
  const result = resolveBin({
    platform: 'win32',
    env: { PATH: 'C:\\Windows\\System32' },
    home: 'C:\\Users\\tester',
    exists: (path) => path === official,
  })
  assert.equal(result, official)
})

test('resolveBin keeps the official installer path ahead of legacy locations', () => {
  const official = 'C:\\Users\\tester\\.cua-driver\\packages\\current\\cua-driver.exe'
  const legacy = 'C:\\Users\\tester\\.local\\bin\\cua-driver.exe'
  const result = resolveBin({
    platform: 'win32',
    env: { PATH: '' },
    home: 'C:\\Users\\tester',
    exists: (path) => path === official || path === legacy,
  })
  assert.equal(result, official)
})
