import test from 'node:test'
import assert from 'node:assert/strict'
import { VIEW_DEFAULTS, readView, writeView } from '../src/utils/shareView.js'

test('shared view round-trips arrays, unicode, booleans and CAMIDs', () => {
  const defaults = { ...VIEW_DEFAULTS, species: [], subspecies: [], sex: 'male and female', camids: '' }
  const state = { ...defaults, species: ['Ithomia salapia', 'A & B'], subspecies: ['é / x'], onlyPhotos: false, expandPredictions: true, sortBy: 'SexConfidence', camids: 'CAM070978\nCAM042012' }
  const url = writeView('https://example.org/gallery/search', state, defaults)
  assert.deepEqual(readView(new URL(url).search, defaults), state)
  assert.equal(new URL(url).pathname, '/gallery/search')
})
test('invalid enum and boolean values restore safe defaults', () => {
  assert.deepEqual(readView('?columns=99&sortBy=bad&onlyPhotos=nope', VIEW_DEFAULTS), VIEW_DEFAULTS)
  assert.equal(readView('?onlyPhotos=0', VIEW_DEFAULTS).onlyPhotos, false)
})
test('default view has explicit marker and removes stale tab filters', () => {
  const url = new URL(writeView('https://example.org/gallery/crispr?insectaryId=old', VIEW_DEFAULTS, VIEW_DEFAULTS))
  assert.equal(url.search, '?view=1')
})
