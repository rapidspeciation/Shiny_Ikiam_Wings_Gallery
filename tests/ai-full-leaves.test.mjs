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
    assert.equal(PREDICTION_CACHE_VERSION, 'full-leaves-v3')
  } finally {
    await vite.close()
  }
})

test('new uploads do not infer geography unless the user requests it', () => {
  const source = readFileSync('src/components/AIIdTab.vue', 'utf8')
  assert.match(source, /onResult: \(raw\) => \{[\s\S]*?applyLeaves\(r, raw\.leaves\)/)
  assert.doesNotMatch(source, /applyLeaves\(r, raw\.leaves, noLoc\)/)
  assert.doesNotMatch(source, /applyGuess|guessRegion/)
  assert.match(source, /s = suggestLocations\(await getCountryPresence\(\), leaves\)/)
  assert.match(source, /function applyLeaves\(r, leaves\) \{[\s\S]*?updateSuggest\(r\)/)
  assert.match(source, /function rerank\(r\) \{[\s\S]*?resolvePrior\(loc\)/)
  // only EXIF GPS is applied without a tap
  assert.match(source, /loc: exifLoc\(it\.gps\)/)
  assert.match(source, /cached\?\.version === PREDICTION_CACHE_VERSION/)
})

test('location is chosen per photo with an Any chip that resets the prior', () => {
  const source = readFileSync('src/components/AIIdTab.vue', 'utf8')
  const { descriptor, errors } = parse(source)
  assert.equal(errors.length, 0)
  compileScript(descriptor, { id: 'ai-identifier' })
  // no pre-upload "Where was it photographed?" panel; each result starts at Any
  assert.doesNotMatch(descriptor.template.content, /Where was it photographed/)
  assert.match(descriptor.scriptSetup.content, /exifGps: it\.gps \|\| null, loc: exifLoc\(it\.gps\)/)
  assert.match(descriptor.scriptSetup.content, /function resetLocation\(r\) \{ setLoc\(r, null\) \}/)
  assert.match(descriptor.template.content, /@any="resetLocation\(active\)"/)
  const list = parse(readFileSync('src/components/AILocationChips.vue', 'utf8')).descriptor
  assert.match(list.template.content, /:aria-pressed="!loc" @click="emit\('any'\)">Any<\/button>/)
  // East/West side selector and chips are gone; Ecuador regions replace them
  assert.doesNotMatch(list.template.content + descriptor.scriptSetup.content, /of Andes|Side of the Andes|REGION_OPTS/)
  assert.match(list.template.content, /Region in Ecuador/)
  assert.match(list.template.content, /Location from photo:/)
  assert.match(list.template.content, /Don't use/)
  assert.match(list.template.content, /Pick on map/)
  assert.match(list.template.content, /:aria-pressed="isSuggestActive\(s\)"/)
  // suggestion chips carry no percentages
  assert.doesNotMatch(list.template.content, /s\.score/)
})
