import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
test('default collection model uses verified paired predictions and preserves public API configuration', () => {
  const source = readFileSync('src/composables/useCurationData.js', 'utf8')
  assert.match(source, /candidate_d: \{ file: 'predictions_expanded_concat_dv'/)
  const bytes = readFileSync('public/data/predictions_expanded_concat_dv.json')
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '2f75987de896889ee8ed9c09a77a4c97551a5f1934708bf8f63424d8a073fe70')
  const rows = Object.values(JSON.parse(bytes))
  assert.equal(rows.filter(r => r.model_meta?.pairing_policy === 'EXPANDED_PAIRED').length, 3829)
  assert.equal(rows.length, 3849)
  assert.match(readFileSync('.github/workflows/deploy.yml','utf8'), /https:\/\/fr4nzzch-butterfly-id.hf.space/)
})
