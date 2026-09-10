import test from 'node:test'
import assert from 'node:assert/strict'

import { renderWithImage } from '../index.js'
import { buildObserveOutput } from '../lib/observe.js'

const image = {
  attachmentId: 'att-test',
  mediaType: 'image/png',
  bytes: 123,
  width: 640,
  height: 480,
}

test('screen_observe omits image when the capture is null', () => {
  const output = buildObserveOutput({ ok: true, result: 'text', screenshotFile: null, image: null })
  assert.equal(Object.hasOwn(output, 'image'), false)
  assert.equal(output.screenshotFile, null)
})

test('screen_observe preserves a native image object', () => {
  const output = buildObserveOutput({ ok: true, result: 'text', image })
  assert.deepEqual(output.image, image)
})

test('renderWithImage returns only a text block without an image', () => {
  assert.deepEqual(renderWithImage({}, { result: 'text only' }), [
    { type: 'text', text: 'text only' },
  ])
})

test('renderWithImage appends an image block when an image exists', () => {
  const blocks = renderWithImage({}, { result: 'with image', image })
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks[0], { type: 'text', text: 'with image' })
  assert.deepEqual(blocks[1], {
    type: 'image',
    attachment: image,
  })
})
