import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  setTaxonNameMap, canonical, aliasesOf, lookupOrder, checklistNames, formerNames, formerlyText,
  canonicalLeaves, firstHit,
} from '../src/utils/taxonNames.js'
import { extraRows, speciesCandidates, subspeciesCandidates, probIndex } from '../src/utils/taxonTree.js'
import { createInatClient } from '../src/utils/inatPhotos.js'

const REAL = JSON.parse(readFileSync('public/data/taxon_name_map.json', 'utf8'))
const MOCK = {
  species: {
    'Agraulis vanillae': 'Dione vanillae',
    'Dryas julia': 'Dryas iulia',
    'Eurema albula': 'Abaeis albula',
    'Anastrus neaerisA': 'Anastrus neaeris',
    'Anastrus neaerisB': 'Anastrus neaeris',
  },
  leaves: {
    'Agraulis vanillae lucina': 'Dione vanillae lucina',
    'Dryas julia moderata': 'Dryas iulia moderata',
    'Heliconius erato dignusA': 'Heliconius erato dignus',
  },
}

test('the shipped map has the expected shape and no chains', () => {
  assert.equal(REAL.schema, 'wings-taxon-name-map/1')
  assert.equal(Object.keys(REAL.species).length, 252)
  for (const part of ['species', 'leaves']) {
    for (const [o, n] of Object.entries(REAL[part])) {
      assert.ok(typeof n === 'string' && n && o !== n, `${part}: ${o}`)
      assert.ok(!(n in REAL.species) && !(n in REAL.leaves), `chain at ${n}`)
    }
  }
})

test('canonical maps old species, leaves and trinomials of renamed species; identity otherwise', () => {
  setTaxonNameMap(MOCK)
  assert.equal(canonical('Agraulis vanillae'), 'Dione vanillae')
  assert.equal(canonical('Agraulis vanillae lucina'), 'Dione vanillae lucina')
  // trinomial not in the leaf map: species part renamed
  assert.equal(canonical('Agraulis vanillae incarnata'), 'Dione vanillae incarnata')
  assert.equal(canonical('  Dryas   julia '), 'Dryas iulia')
  assert.equal(canonical('Dione vanillae'), 'Dione vanillae')
  assert.equal(canonical('Heliconius erato dignusA'), 'Heliconius erato dignus')
  assert.equal(canonical('Heliconius erato'), 'Heliconius erato')
  assert.equal(canonical('Agraulis'), 'Agraulis')   // genera are not renamed on their own
  assert.equal(canonical(''), '')
  assert.equal(canonical(null), '')
})

test('aliasesOf lists every old name of a canonical taxon, from either name', () => {
  setTaxonNameMap(MOCK)
  assert.deepEqual(aliasesOf('Dione vanillae'), ['Agraulis vanillae'])
  assert.deepEqual(aliasesOf('Agraulis vanillae'), ['Agraulis vanillae'])
  assert.deepEqual(aliasesOf('Anastrus neaeris'), ['Anastrus neaerisA', 'Anastrus neaerisB'])
  assert.deepEqual(aliasesOf('Dione vanillae lucina'), ['Agraulis vanillae lucina'])
  assert.deepEqual(aliasesOf('Dione vanillae incarnata'), ['Agraulis vanillae incarnata'])
  assert.deepEqual(aliasesOf('Mechanitis polymnia'), [])
  assert.deepEqual(lookupOrder('Dione vanillae'), ['Dione vanillae', 'Agraulis vanillae'])
  assert.deepEqual(lookupOrder('Agraulis vanillae'), ['Agraulis vanillae', 'Dione vanillae'])
  assert.deepEqual(lookupOrder('Mechanitis polymnia'), ['Mechanitis polymnia'])
  assert.deepEqual(checklistNames('Dione'), ['Dione', 'Agraulis'])
  assert.deepEqual(checklistNames('Mechanitis'), ['Mechanitis'])
})

test('formerly text only for a canonical name with aliases', () => {
  setTaxonNameMap(MOCK)
  assert.deepEqual(formerNames('Dione vanillae'), ['Agraulis vanillae'])
  assert.equal(formerlyText('Dione vanillae'), 'formerly Agraulis vanillae')
  assert.equal(formerlyText('Agraulis vanillae'), '')   // an old name is not "formerly" anything
  assert.equal(formerlyText('Mechanitis polymnia'), '')
  assert.equal(formerlyText('Anastrus neaeris', 1), 'formerly Anastrus neaerisA and 1 more')
  assert.doesNotMatch(formerlyText('Anastrus neaeris'), /—/)
})

test('real map: documented examples', () => {
  setTaxonNameMap(REAL)
  assert.equal(canonical('Agraulis vanillae'), 'Dione vanillae')
  assert.equal(canonical('Eurema albula'), 'Abaeis albula')
  assert.equal(canonical('Dryas julia'), 'Dryas iulia')
  assert.equal(canonical('Dryas julia moderata'), 'Dryas iulia moderata')
  assert.ok(aliasesOf('Dione vanillae').includes('Agraulis vanillae'))
  assert.ok(aliasesOf('Dione vanillae lucina').includes('Agraulis vanillae lucina'))
  // every old name resolves back through its canonical name
  for (const part of ['species', 'leaves']) {
    for (const [o, n] of Object.entries(REAL[part])) {
      assert.equal(canonical(o), n)
      assert.ok(aliasesOf(n).includes(o), `${o} -> ${n}`)
    }
  }
})

test('canonicalLeaves renames and sums merged leaves', () => {
  setTaxonNameMap(MOCK)
  const got = canonicalLeaves([['Dryas julia moderata', 0.2], ['Dryas iulia moderata', 0.3], ['Agraulis vanillae lucina', 0.4], ['Mechanitis polymnia', 0.1]])
  assert.deepEqual(got.map(([n]) => n), ['Dryas iulia moderata', 'Dione vanillae lucina', 'Mechanitis polymnia'])
  assert.ok(Math.abs(got[0][1] - 0.5) < 1e-12)
})

test('firstHit tries the requested name, then the canonical name and aliases', async () => {
  setTaxonNameMap(MOCK)
  const data = { 'Agraulis vanillae': 'old record' }
  const tried = []
  const r = await firstHit('Dione vanillae', (n) => { tried.push(n); return data[n] ?? null })
  assert.deepEqual(r, { value: 'old record', name: 'Agraulis vanillae' })
  assert.deepEqual(tried, ['Dione vanillae', 'Agraulis vanillae'])
  const miss = await firstHit('Nothing here', () => null)
  assert.equal(miss.name, '')
})

test('tree "+ all" rows never list an old and a new name of the same taxon', () => {
  setTaxonNameMap(MOCK)
  // Collection (region mode): old-name model, checklist has both spellings
  const checklist = {
    'Dryas iulia': { East: 1, West: 1, countries: { Ecuador: 1 } },
    'Dryas julia': { East: 1, West: 0, countries: { Ecuador: 1 } },
    'Dryas iulia moderata': { East: 1, West: 0 },
    'Dryas julia moderata': { East: 1, West: 0 },
    'Dryas iulia alcionea': { East: 1, West: 0 },
    'Dryas other': { East: 1, West: 0 },
  }
  const oldPred = { species: [['Dryas julia', 0.8, 0, [['Dryas julia moderata', 0.8, 0]]]], species_all: [['Dryas julia', 0.8, 0], ['Dryas other', 0.1, 0]] }
  const idx = probIndex(oldPred)
  const sp = extraRows(speciesCandidates(oldPred, 'Dryas', { checklist, side: '' }), ['Dryas julia'], idx.species, 'species')
  assert.deepEqual(sp.map((r) => r.taxon), ['Dryas other'])   // no 'Dryas iulia' next to the shown 'Dryas julia'
  const ss = extraRows(subspeciesCandidates(oldPred, 'Dryas iulia', { checklist, side: '' }), ['Dryas julia moderata'], idx.subspecies, 'subspecies')
  assert.deepEqual(ss.map((r) => r.taxon), ['Dryas iulia alcionea'])
  // a model name wins over its checklist synonym when neither is shown yet
  const both = extraRows(speciesCandidates(oldPred, 'Dryas', { checklist, side: '' }), [], idx.species, 'species')
  assert.deepEqual(both.map((r) => r.taxon), ['Dryas julia', 'Dryas other'])

  // AI Identifier (vocabulary mode) with a V1000-style distribution: one name per taxon,
  // renamed species grouped under the new genus
  // (canonicalLeaves output marginalised the way rankLeaves does; the full pipeline
  // is covered in tests/v1000-names.test.mjs)
  const leaves = canonicalLeaves([['Agraulis vanillae lucina', 0.4], ['Dione vanillae lucina', 0.2], ['Dione juno', 0.1], ['Dryas julia moderata', 0.3]])
  const spMass = new Map()
  for (const [n, p] of leaves) { const s = n.split(' ').slice(0, 2).join(' '); spMass.set(s, (spMass.get(s) || 0) + p) }
  const species_all = [...spMass].sort((a, b) => b[1] - a[1]).map(([n, p]) => [n, p, 0])
  const pred = { species: [], species_all }
  const dione = extraRows(speciesCandidates(pred, 'Dione', { mode: 'vocabulary' }), [], probIndex(pred).species, 'species')
  assert.deepEqual(dione.map((r) => r.taxon), ['Dione vanillae', 'Dione juno'])
  assert.equal(speciesCandidates(pred, 'Agraulis', { mode: 'vocabulary' }).length, 0)
})

test('iNaturalist: query the new name, then retry with the old name', async () => {
  setTaxonNameMap(MOCK)
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(decodeURIComponent(new URL(url).searchParams.get('taxon_name') || ''))
    const name = new URL(url).searchParams.get('taxon_name')
    const results = name === 'Agraulis vanillae' ? [{
      id: 7, taxon: { name: 'Agraulis vanillae', rank: 'species', iconic_taxon_name: 'Insecta' },
      photos: [{ url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/7/square.jpg' }],
    }] : []
    return { ok: true, json: async () => ({ results }) }
  }
  const client = createInatClient({ fetchImpl, storage: null, namesFor: async (n) => lookupOrder(n) })
  const r = await client.fieldPhotos('Dione vanillae lucina')
  assert.equal(r.photos.length, 1)
  assert.equal(r.shownTaxon, 'Agraulis vanillae')
  assert.equal(r.resolvedAs, 'Agraulis vanillae')
  assert.equal(r.speciesFallback, true)
  assert.deepEqual(calls, ['Dione vanillae lucina', 'Agraulis vanillae lucina', 'Dione vanillae', 'Agraulis vanillae'])
  // an old name (Collection) is still queried first, unchanged
  const old = await client.fieldPhotos('Agraulis vanillae')
  assert.equal(old.shownTaxon, 'Agraulis vanillae')
  assert.equal(old.resolvedAs, '')
})
