import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readJson = async (relativePath) =>
  JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'))

const manifest = await readJson('../package.json')
const lockfile = await readJson('../package-lock.json')

const HOST_PACKAGES = [
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/schemastery',
]

test('host-owned DSH packages are peers, not runtime dependencies', () => {
  for (const packageName of HOST_PACKAGES) {
    assert.equal(
      manifest.dependencies?.[packageName],
      undefined,
      `${packageName} must not be bundled as a runtime dependency`,
    )
    assert.equal(
      manifest.peerDependencies?.[packageName],
      '*',
      `${packageName} must be resolved from the DSH host`,
    )
    assert.ok(
      manifest.devDependencies?.[packageName],
      `${packageName} must remain available for local tests`,
    )
  }
})

test('package-lock records the same host-first dependency contract', () => {
  const root = lockfile.packages['']
  assert.equal(root.dependencies, undefined)
  assert.deepEqual(root.peerDependencies, manifest.peerDependencies)
  assert.deepEqual(root.devDependencies, manifest.devDependencies)
})
