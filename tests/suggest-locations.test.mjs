import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

async function load() {
  const vite = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  const mod = await vite.ssrLoadModule('/src/utils/geoPrior.js')
  return { vite, suggestLocations: mod.suggestLocations }
}

test('suggestLocations returns the top three countries by prediction mass, with no East/West split', async () => {
  const { vite, suggestLocations } = await load()
  try {
    const presence = { 'Godyris dircenna': ['EC', 'PE'], 'Pteronymia ozia': ['EC', 'CO'], 'Mechanitis polymnia': ['BR'] }
    const leaves = [['Godyris dircenna', 0.5], ['Pteronymia ozia alpha', 0.3], ['Mechanitis polymnia', 0.1], ['Unknown taxon', 0.1]]
    const got = suggestLocations(presence, leaves)
    assert.deepEqual(got.map((s) => s.iso), ['EC', 'PE', 'CO'])
    assert.ok(got.every((s) => s.kind === 'country' && !('side' in s)))
    assert.ok(Math.abs(got[0].score - 0.8) < 1e-9)
    assert.deepEqual(suggestLocations(presence, [['Unknown taxon', 1]]), [])
  } finally { await vite.close() }
})

test('upload panel has no fixed location presets; suggestions come from each result', () => {
  const source = readFileSync('src/components/AIIdTab.vue', 'utf8')
  assert.doesNotMatch(source, /QUICK_LOCATIONS|Quick location picks/)
  assert.match(source, /suggestLocations\(await getCountryPresence\(\), leaves\)/)
  assert.match(source, /suggestEcRegion\(await getGeoPrior\(\), speciesProbs\(leaves\)\)/)
})
