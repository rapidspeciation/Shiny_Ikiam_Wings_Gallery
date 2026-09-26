import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
test('default collection model uses verified paired predictions and preserves public API configuration', () => {
  const source = readFileSync('src/composables/useCurationData.js', 'utf8')
  assert.match(source, /candidate_d: \{ file: 'predictions_expanded_concat_dv'/)
  const bytes = readFileSync('public/data/predictions_expanded_concat_dv.json')
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '43f315cc6282991971723d3ba5d0ada6b02b43d932fff0806ff00fff26f7dea6')
  const rows = Object.values(JSON.parse(bytes))
  const paired = rows.filter(r => r.model_meta?.pairing_policy === 'EXPANDED_PAIRED')
  assert.equal(paired.length, 3829)
  assert.equal(rows.length, 3849)
  assert.equal(rows.length - paired.length, 20)
  assert.ok(paired.every(r => r.model_meta.route === 'known_pair_attention_v1' &&
    r.model_meta.feature_dimension === 1024 && r.model_meta.source_views.dorsal &&
    r.model_meta.source_views.ventral && r.n_views === 2 && r.oof === 0))
  const roles = {}
  for (const row of paired) {
    const role = row.model_meta.attention_training_role
    roles[role] = (roles[role] ?? 0) + 1
  }
  assert.deepEqual(roles, {
    train: 2226, dev: 261, cal: 206, test: 314, absent_from_attention_training_manifest: 822
  })
  const sexBytes = readFileSync('public/data/sex_predictions.json')
  assert.equal(createHash('sha256').update(sexBytes).digest('hex'), '79df4a56e45efa782672949fddbf301ce297548cbc6a3ec306023074a7ba214d')
  assert.match(readFileSync('.github/workflows/deploy.yml','utf8'), /https:\/\/fr4nzzch-butterfly-id.hf.space/)
})
