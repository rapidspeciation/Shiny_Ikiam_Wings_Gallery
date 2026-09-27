import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

test('GBIF country presence is merged into species and subspecies checklist entries', async () => {
  const vite = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  try {
    const { mergeGbifPresence, geoWeight, entryFor, DEFAULT_EPS } = await vite.ssrLoadModule('/src/utils/geoPrior.js')
    const ck = {
      'Anteos maerula': { East: 0, West: 1, countries: { Ecuador: 6 } },
      'Anteos maerula lacordairei': { East: 0, West: 1, countries: { Ecuador: 2 } },
      'Agraulis vanillae lucina': { East: 1, West: 0, countries: { Ecuador: 1 } },
    }
    const presence = { species: { 'Anteos maerula': ['Colombia', 'Peru'], 'Dione vanillae': ['Colombia'], 'Heliconius sara': ['Peru'] } }
    const canon = (n) => (n === 'Agraulis vanillae' ? 'Dione vanillae' : n)
    const m = mergeGbifPresence(ck, presence, canon)
    assert.deepEqual(m['Anteos maerula'].countries, { Ecuador: 6, Colombia: 1, Peru: 1 })
    assert.equal(m['Anteos maerula lacordairei'].countries.Colombia, 1)
    assert.equal(m['Agraulis vanillae lucina'].countries.Colombia, 1)   // old-name subspecies via canonical species
    assert.deepEqual(m['Heliconius sara'].countries, { Peru: 1 })        // species only known from GBIF
    assert.equal(ck['Anteos maerula'].countries.Colombia, undefined)      // input not mutated
    assert.equal(DEFAULT_EPS, 0.3)
    assert.equal(geoWeight(entryFor(m, 'Anteos maerula lacordairei'), 'Colombia', ''), 1)
    assert.equal(geoWeight(entryFor(m, 'Anteos maerula lacordairei'), 'Brazil', ''), 0.3)
    assert.equal(geoWeight(entryFor(m, 'Anteos maerula'), 'Ecuador', 'East'), 1) // side does not re-weight
  } finally { await vite.close() }
})

test('the shipped GBIF presence file is well formed', () => {
  const p = JSON.parse(readFileSync('public/data/gbif_country_presence.json', 'utf8'))
  assert.equal(p.schema, 'wings-gbif-country-presence/1')
  assert.ok(Object.keys(p.species).length > 2000)
  assert.ok(p.species['Dione vanillae'] === undefined || Array.isArray(p.species['Dione vanillae']))
})
