// Simulates the corrected-name head (V1000): a /predict_raw response whose
// full_leaves use the new names goes through predictOne -> rankLeaves -> tree ->
// location suggestions -> museum / guide lookups, against the real region
// checklist and guide links, with the collection and GBIF mocked. The same
// photo under the old-name head (G1000) must give the same result.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { parse } from '@vue/compiler-sfc'

const API = 'https://space.example.test'
const BASE = '/Shiny_Ikiam_Wings_Gallery/'
const MAP = JSON.parse(readFileSync('public/data/taxon_name_map.json', 'utf8'))
const CHECKLIST = JSON.parse(readFileSync('public/data/region_checklist.json', 'utf8'))
const LINKS = JSON.parse(readFileSync('public/data/taxon_links.json', 'utf8'))

// Collection records keep the recorded (old) names.
const COLLECTION = [
  { CAM_ID: 'CAM000001', Species: 'Agraulis vanillae', Subspecies_Form: 'lucina', URLv: 'https://drive.google.com/uc?id=v1', URLd: 'https://drive.google.com/uc?id=d1' },
  { CAM_ID: 'CAM000002', Species: 'Dryas iulia', Subspecies_Form: 'moderata', URLv: 'https://drive.google.com/uc?id=v2' },
  { CAM_ID: 'CAM000003', Species: 'Dryas julia', Subspecies_Form: 'NA', URLv: 'https://drive.google.com/uc?id=v3' },
]

// V1000-style leaves: new names only, >= 1000 leaves, summing to 1.
const TOP = [
  ['Dione vanillae lucina', 0.55],
  ['Dione vanillae vanillae', 0.1],
  ['Dryas iulia moderata', 0.12],
  ['Abaeis albula', 0.08],
  ['Heliconius erato', 0.05],
]
const FILLER = 1000
const rest = 1 - TOP.reduce((a, [, p]) => a + p, 0)
const V1000 = [...TOP, ...Array.from({ length: FILLER }, (_, i) => [`Fillergenus filler${i}`, rest / FILLER])]

function routes(fullLeaves) {
  const gbifCalls = []
  const fetchStub = async (input) => {
    const url = String(input)
    const json = (body) => ({ ok: true, status: 200, json: async () => body })
    if (url === `${API}/predict_raw`) {
      return json({ results: [{ filename: 'photo.jpeg', leaves: fullLeaves.slice(0, 64), full_leaves: fullLeaves, leaf_distribution_complete: true, wing_box: null, boxes: [] }] })
    }
    if (url === `${BASE}data/collection.json`) return json(COLLECTION)
    if (url === `${BASE}data/taxon_links.json`) return json(LINKS)
    if (url === `${BASE}data/taxon_name_map.json`) return json(MAP)
    if (url.startsWith('https://api.gbif.org/v1/species/match')) {
      const name = new URL(url).searchParams.get('name')
      gbifCalls.push(name)
      return json(name === 'Eurema albula' ? { usageKey: 5 } : {})
    }
    if (url.startsWith('https://api.gbif.org/v1/occurrence/search')) {
      return json({ results: [{ key: 99, basisOfRecord: 'PRESERVED_SPECIMEN', media: [{ type: 'StillImage', identifier: 'https://example.org/eurema.jpg' }] }] })
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { fetchStub, gbifCalls }
}

async function withVite(fn) {
  process.env.VITE_AIID_API = API
  const vite = await createServer({
    configFile: 'vite.config.js', optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
  })
  const realFetch = globalThis.fetch
  try {
    const load = (p) => vite.ssrLoadModule(p)
    await fn({
      names: await load('/src/utils/taxonNames.js'),
      predict: await load('/src/utils/aiPredict.js'),
      geo: await load('/src/utils/geoPrior.js'),
      tree: await load('/src/utils/taxonTree.js'),
      refs: await load('/src/utils/aiReference.js'),
      curation: await load('/src/composables/useCurationData.js'),
      setFetch: (f) => { globalThis.fetch = f },
    })
  } finally {
    globalThis.fetch = realFetch
    delete process.env.VITE_AIID_API
    await vite.close()
  }
}

const photo = () => ({ id: 'p1', name: 'photo.jpeg', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) })
const row = (list, name) => list.find((r) => r[0] === name)

test('a V1000 response ranks, tags off-region and groups genera through the old-name checklist', async () => {
  await withVite(async ({ predict, geo, tree, setFetch }) => {
    const { fetchStub } = routes(V1000)
    setFetch(fetchStub)
    const raw = await predict.predictOne(photo(), 0)
    assert.equal(raw.mock, false)
    assert.equal(raw.leaves.length, V1000.length)
    assert.equal(raw.leaves[0][0], 'Dione vanillae lucina')

    // The checklist only knows Dione vanillae from Costa Rica; its Ecuador records
    // are under Agraulis vanillae. Through the aliases it is not off-region there.
    assert.equal(CHECKLIST['Dione vanillae'].countries.Ecuador, undefined)
    assert.ok(CHECKLIST['Agraulis vanillae'].countries.Ecuador > 0)
    assert.equal(CHECKLIST['Dione vanillae lucina'], undefined)

    const ec = predict.rankLeaves(raw.leaves, CHECKLIST, { country: 'Ecuador', side: '' })
    assert.equal(ec.species[0][0], 'Dione vanillae')
    assert.equal(row(ec.species, 'Dione vanillae')[2], 0)
    assert.equal(row(ec.subspecies_all, 'Dione vanillae lucina')[2], 0)
    assert.equal(row(ec.genus, 'Dione')[2], 0)
    // Agraulis vanillae lucina is recorded only East of the Andes
    const west = predict.rankLeaves(raw.leaves, CHECKLIST, { country: 'Ecuador', side: 'West' })
    assert.equal(row(west.subspecies_all, 'Dione vanillae lucina')[2], 1)
    assert.equal(row(west.species_all, 'Dione vanillae')[2], 0)   // the species is recorded West (Agraulis vanillae)
    const east = predict.rankLeaves(raw.leaves, CHECKLIST, { country: 'Ecuador', side: 'East' })
    assert.equal(row(east.subspecies_all, 'Dione vanillae lucina')[2], 0)
    // a country with none of the merged records is still off-region
    const gt = predict.rankLeaves(raw.leaves, CHECKLIST, { country: 'Guatemala', side: '' })
    assert.equal(row(gt.species_all, 'Dione vanillae')[2], 1)

    // location suggestions use the Agraulis vanillae records
    const sug = geo.suggestLocations(CHECKLIST, raw.leaves)
    assert.deepEqual([sug[0].country, sug[0].side], ['Ecuador', 'East'])

    // tree: Dione vanillae groups under Dione, no Agraulis genus, no old names anywhere
    const t = tree.buildTree(ec)
    assert.equal(t[0].taxon, 'Dione')
    assert.equal(t[0].species[0].taxon, 'Dione vanillae')
    assert.ok(!t.some((g) => g.taxon === 'Agraulis'))
    const all = [...ec.genus_all, ...ec.species_all, ...ec.subspecies_all].map((r) => r[0])
    for (const name of all) assert.ok(!(name in MAP.species) && !(name in MAP.leaves), `old name ${name}`)
  })
})

test('the old-name head (G1000) gives the same ranking as V1000', async () => {
  await withVite(async ({ names, predict, setFetch }) => {
    names.setTaxonNameMap(MAP)
    // the same distribution under old names; merged leaves split across their old names
    const old = []
    for (const [n, p] of V1000) {
      const aliases = names.aliasesOf(n)
      if (!aliases.length) old.push([n, p])
      else aliases.forEach((a) => old.push([a, p / aliases.length]))
    }
    assert.ok(old.some(([n]) => n === 'Agraulis vanillae lucina'))
    const results = []
    for (const leaves of [V1000, old]) {
      setFetch(routes(leaves).fetchStub)
      const raw = await predict.predictOne(photo(), 0)
      results.push(predict.rankLeaves(raw.leaves, CHECKLIST, { country: 'Ecuador', side: 'East', topK: 10 }))
    }
    assert.deepEqual(results[1].species, results[0].species)
    assert.deepEqual(results[1].genus, results[0].genus)
    assert.deepEqual(results[1].subspecies, results[0].subspecies)
  })
})

test('museum photos and guide links resolve new names through the old names', async () => {
  await withVite(async ({ refs, curation, setFetch }) => {
    const { fetchStub, gbifCalls } = routes(V1000)
    setFetch(fetchStub)
    // Sanger records under Agraulis vanillae lucina
    const lucina = await refs.referencesFor('Dione vanillae lucina', 6)
    assert.equal(lucina.source, 'sanger')
    assert.equal(lucina.level, 'subspecies')
    assert.deepEqual(lucina.recordedAs, ['Agraulis vanillae lucina'])
    assert.deepEqual(lucina.photos.map((p) => p.boxKey), ['CAM000001v', 'CAM000001d'])
    // the old name finds the same specimens (Collection drawer)
    const oldName = await refs.referencesFor('Agraulis vanillae lucina', 6)
    assert.deepEqual(oldName.photos.map((p) => p.boxKey), ['CAM000001v', 'CAM000001d'])
    assert.deepEqual(oldName.recordedAs, [])
    // a merge shows the specimens of both names, the requested name first
    const iulia = await refs.referencesFor('Dryas iulia', 6)
    assert.deepEqual(iulia.photos.map((p) => p.boxKey), ['CAM000002v', 'CAM000003v'])
    assert.deepEqual(iulia.recordedAs, ['Dryas julia'])
    // GBIF fallback tries the new name, then the old one
    const albula = await refs.referencesFor('Abaeis albula', 6)
    assert.equal(albula.source, 'gbif')
    assert.deepEqual(albula.recordedAs, ['Eurema albula'])
    assert.deepEqual(gbifCalls.slice(0, 2), ['Abaeis albula', 'Eurema albula'])

    // guides: BoA has the new species page; the .eu fiche exists only under the old name
    const links = await curation.getLinks('Dione vanillae lucina')
    assert.equal(links.boa, LINKS.boa['Dione vanillae'])
    assert.equal(links.sangay, LINKS.eu_fiche.sangay['Agraulis lucina'])
    assert.equal(links.noreste, LINKS.eu_fiche.noreste['Agraulis lucina'])
    const oldLinks = await curation.getLinks('Agraulis vanillae lucina')
    assert.equal(oldLinks.sangay, links.sangay)
    assert.equal(oldLinks.boa, LINKS.boa['Agraulis vanillae'])   // an old name keeps its own page first
    const genus = await curation.getLinks('Dione')
    assert.equal(genus.sangay, LINKS.eu_thumb.sangay.Dione)
  })
})

test('AI Identifier shows "formerly" notes; the Collection does not', () => {
  const ai = parse(readFileSync('src/components/AIIdTab.vue', 'utf8')).descriptor.template.content
  assert.equal((ai.match(/<AIReferencePanel[^>]*former-names/g) || []).length, 2)
  assert.match(ai, /<TaxonTree[^>]*former-names/)
  for (const f of ['src/components/PredictionPanel.vue', 'src/components/TaxonDrawer.vue', 'src/components/CollectionTab.vue']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /former-names/)
  }
  const panel = readFileSync('src/components/AIReferencePanel.vue', 'utf8')
  assert.match(panel, /class="ref-formerly"/)
  assert.doesNotMatch(panel, /— formerly|formerly —/)
})
