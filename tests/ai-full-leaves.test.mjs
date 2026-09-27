import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { parse, compileScript } from '@vue/compiler-sfc'

test('AI Identifier prefers complete unweighted leaves and safely falls back', async () => {
  const vite = await createServer({
    configFile: 'vite.config.js',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    appType: 'custom',
  })
  try {
    const { predictionLeaves, rankLeaves, PREDICTION_CACHE_VERSION } = await vite.ssrLoadModule('/src/utils/aiPredict.js')
    const checklist = JSON.parse(readFileSync('public/data/region_checklist.json'))
    const preview = [['Mechanitis messenoides messenoides', 0.7]]
    const full = Array.from({ length: 7933 }, (_, i) => [`Taxon ${i}`, i === 0 ? 1 : 0])
    const response = { leaves: preview, full_leaves: full, leaf_distribution_complete: true }
    assert.equal(predictionLeaves(response), full)
    const retrained = full.slice(0, 7841)
    assert.equal(predictionLeaves({ ...response, full_leaves: retrained }), retrained)
    assert.equal(predictionLeaves({ ...response, mock: true }), preview)
    assert.equal(predictionLeaves({ ...response, leaf_distribution_complete: false }), preview)
    assert.equal(predictionLeaves({ ...response, full_leaves: full.slice(0, 64) }), preview)
    assert.equal(predictionLeaves({ ...response, full_leaves: full.map((v, i) => i === 1 ? ['Taxon 0', 0] : v) }), preview)
    assert.equal(predictionLeaves({ ...response, full_leaves: full.map((v, i) => i === 0 ? ['Taxon 0', 0.5] : v) }), preview)
    assert.equal(predictionLeaves({ ...response, full_leaves: full.map((v, i) => i === 1 ? ['Taxon 1', NaN] : v) }), preview)
    assert.equal(rankLeaves(preview, checklist, { country: '', side: '' }).species[0][0], 'Mechanitis messenoides')
    assert.equal(rankLeaves(preview, checklist, { country: 'Ecuador', side: 'East' }).species[0][0], 'Mechanitis messenoides')
    assert.equal(PREDICTION_CACHE_VERSION, 'full-leaves-v2')
  } finally {
    await vite.close()
  }
})

test('new uploads do not infer geography unless the user requests it', () => {
  const source = readFileSync('src/components/AIIdTab.vue', 'utf8')
  assert.match(source, /onResult: \(raw\) => \{[\s\S]*?applyLeaves\(r, raw\.leaves\)/)
  assert.doesNotMatch(source, /applyLeaves\(r, raw\.leaves, noLoc\)/)
  assert.doesNotMatch(source, /applyGuess|guessRegion/)
  assert.match(source, /r\.suggest = suggestLocations\(checklist\.value, leaves\)/)
  assert.match(source, /function rerank\(r\) \{[\s\S]*?country: cParam\(r\.country\), side: sideOf\(r\.region\)/)
  assert.match(source, /cached\?\.version === PREDICTION_CACHE_VERSION/)
})

test('manual location selection exposes a bound reactive reset control', () => {
  const source = readFileSync('src/components/AIIdTab.vue', 'utf8')
  const { descriptor, errors } = parse(source)
  assert.equal(errors.length, 0)
  const script = compileScript(descriptor, { id: 'ai-identifier' })
  assert.equal(script.bindings.hasLocation, 'setup-ref')
  assert.match(descriptor.scriptSetup.content, /const hasLocation = computed\(\(\) => country\.value !== ANY \|\| !!region\.value\)/)
  assert.match(descriptor.template.content, /<button v-if="hasLocation"[^>]*@click="resetLocation">Reset location<\/button>/)
  assert.match(descriptor.scriptSetup.content, /function resetLocation\(\) \{ country\.value = ANY; region\.value = null \}/)
})
