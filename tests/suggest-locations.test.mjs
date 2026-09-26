import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const checklist = {
  'Godyris dircenna': { countries: { Ecuador: 1, Peru: 1 }, East: 1, West: 0 },
  'Pteronymia ozia': { countries: { Ecuador: 1, Colombia: 1 }, East: 0, West: 1 },
  'Mechanitis polymnia': { countries: { Brazil: 1 } },
}

async function load() {
  const vite = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  const mod = await vite.ssrLoadModule('/src/utils/geoPrior.js')
  return { vite, suggestLocations: mod.suggestLocations }
}

test('suggestLocations splits Ecuador by side and returns the top three by prediction mass', async () => {
  const { vite, suggestLocations } = await load()
  try {
  const leaves = [['Godyris dircenna', 0.5], ['Pteronymia ozia alpha', 0.3], ['Mechanitis polymnia', 0.1], ['Unknown taxon', 0.1]]
  const got = suggestLocations(checklist, leaves)
  assert.deepEqual(got.map((s) => [s.country, s.side]), [['Ecuador', 'East'], ['Peru', ''], ['Ecuador', 'West']])
  assert.ok(Math.abs(got[0].score - 0.5) < 1e-9)
  assert.deepEqual(suggestLocations(checklist, [['Unknown taxon', 1]]), [])
  } finally { await vite.close() }
})


test('upload panel has no fixed location presets; suggestions come from each result', () => {
  const source = readFileSync('src/components/AIIdTab.vue', 'utf8')
  assert.doesNotMatch(source, /QUICK_LOCATIONS|Quick location picks/)
  assert.match(source, /r\.suggest = suggestLocations\(checklist\.value, leaves\)/)
})
