import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { parse } from '@vue/compiler-sfc'
import { taxonInfo, fmtPct, lowConfidenceMessage, LOW_CONFIDENCE } from '../src/utils/aiCandidates.js'
import { buildTree, SUBSP_MIN } from '../src/utils/taxonTree.js'

const checklist = {
  'Pteronymia ozia': { countries: { Ecuador: 1, Bolivia: 1 }, East: 1, West: 0 },
  'Dircenna dero': { countries: { Ecuador: 1 }, East: 0, West: 1 },
  'Godyris zavaleta': { countries: { Peru: 1 } },
}
const leaves = [
  ['Pteronymia ozia tanampaya', 0.36], ['Pteronymia ozia ozia', 0.03], ['Pteronymia ozia', 0.01],
  ['Dircenna dero', 0.3], ['Godyris zavaleta', 0.2],
  ...Array.from({ length: 8 }, (_, i) => [`Genus${i} species${i}`, 0.1 / 8]),
]

async function loadPredict() {
  const vite = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  return { vite, mod: await vite.ssrLoadModule('/src/utils/aiPredict.js') }
}

test('the table is built from the (re-ranked) species marginals with strong subspecies', async () => {
  const { vite, mod } = await loadPredict()
  try {
    const any = mod.rankLeaves(leaves, checklist, { topK: 10 })
    assert.equal(any.species.length, 10)
    const tree = buildTree(any)
    assert.deepEqual(tree.slice(0, 3).map((g) => g.taxon), ['Pteronymia', 'Dircenna', 'Godyris'])
    const ozia = tree[0].species[0]
    assert.equal(ozia.taxon, 'Pteronymia ozia')
    assert.ok(Math.abs(ozia.prob - 0.4) < 1e-3)
    // first subspecies always, others only >= 5%
    assert.deepEqual(ozia.subspecies.map((s) => [s.taxon, s.prob]), [['Pteronymia ozia tanampaya', 0.36]])
    assert.ok(ozia.subspecies.slice(1).every((s) => s.prob >= SUBSP_MIN))
    assert.equal(tree.some((g) => g.species.some((s) => s.oor)), false)
    // side of the Andes only tags (it no longer re-ranks): Pteronymia ozia is East only
    const west = mod.rankLeaves(leaves, checklist, { country: 'Ecuador', side: 'West', topK: 10 })
    const w = buildTree(west)
    assert.equal(w[0].taxon, 'Pteronymia')
    assert.equal(w.find((g) => g.taxon === 'Pteronymia').species[0].oor, true)
    assert.equal(west.species_all.find((c) => c[0] === 'Godyris zavaleta')[2], 1)
    // default topK is unchanged for other callers
    assert.equal(mod.rankLeaves(leaves, checklist).species.length, 8)
  } finally { await vite.close() }
})

test('taxon lookup and percent formatting', () => {
  const pred = { genus: [['Pteronymia', 0.52, 0], ['Dircenna', 0.07, 0]],
    species: [['Pteronymia ozia', 0.4, 0, [['Pteronymia ozia tanampaya', 0.36, 1]]]], species_all: [['Pteronymia ozia', 0.4, 0], ['Oleria onega', 0.002, 0]] }
  assert.deepEqual(taxonInfo(pred, 'Pteronymia ozia tanampaya'), { taxon: 'Pteronymia ozia tanampaya', prob: 0.36, oor: true, rank: 'subspecies' })
  assert.equal(taxonInfo(pred, 'Oleria onega').prob, 0.002)
  assert.deepEqual(taxonInfo(pred, 'Dircenna'), { taxon: 'Dircenna', prob: 0.07, oor: false, rank: 'genus' })
  assert.equal(taxonInfo(pred, 'Nope nope'), null)
  assert.equal(fmtPct(0.002), '<1%')
  assert.equal(fmtPct(0), '0%')
  assert.equal(fmtPct(0.364), '36%')
})

test('low-confidence banner shows below 50% and suggests a location only when none is set', () => {
  assert.equal(LOW_CONFIDENCE, 0.5)
  const at = (p) => ({ species: [['Godyris zavaleta', p, 0, []]] })
  assert.equal(lowConfidenceMessage(at(0.34), false),
    'Uncertain: the top guess is only 34%. Compare the candidates below before trusting it. Selecting where the photo was taken can help.')
  assert.equal(lowConfidenceMessage(at(0.34), true), 'Uncertain: the top guess is only 34%. Compare the candidates below before trusting it.')
  assert.match(lowConfidenceMessage(at(0.499), true), /only 50%/)
  assert.equal(lowConfidenceMessage(at(0.5), false), '')
  assert.equal(lowConfidenceMessage(at(0.91), false), '')
  assert.equal(lowConfidenceMessage(null, false), '')
  assert.doesNotMatch(lowConfidenceMessage(at(0.2), false), /—/)
})

test('results view wiring: tabs, table, banner, reference tabs and no licence text', () => {
  const tab = parse(readFileSync('src/components/AIIdTab.vue', 'utf8')).descriptor
  assert.match(tab.template.content, /role="tablist" aria-label="Your photos"/)
  assert.match(tab.template.content, /role="dialog" aria-modal="true"/)
  assert.match(tab.scriptSetup.content, /topK: TOP_SPECIES/)
  assert.doesNotMatch(tab.template.content, /PredictionPanel|AIReferenceGallery/)
  assert.match(tab.template.content, /Predictions<\/div>/)
  assert.match(tab.template.content, /v-if="lowConfidence" class="low-conf" role="status"/)
  assert.match(tab.template.content, /@activate="openSheet"/)
  const panel = parse(readFileSync('src/components/AIReferencePanel.vue', 'utf8')).descriptor
  assert.match(panel.scriptSetup.content, /const tab = ref\('field'\)/)   // Field photos is the default tab
  assert.match(panel.template.content, /Field photos \(/)
  assert.match(panel.template.content, /Museum \(/)
  assert.match(panel.template.content, /View on iNaturalist ↗/)
  for (const src of [panel.template.content, readFileSync('src/utils/inatPhotos.js', 'utf8'), readFileSync('src/utils/aiReference.js', 'utf8')]) {
    assert.doesNotMatch(src, /licen[cs]e|CC BY/i)
  }
  for (const f of ['src/components/AIIdTab.vue', 'src/components/AILocationChips.vue', 'src/components/TaxonTree.vue', 'src/components/AIReferencePanel.vue']) {
    // results UI only (the About copy is maintained separately)
    const t = parse(readFileSync(f, 'utf8')).descriptor.template.content.split('<!-- About (simplified) -->')[0]
    assert.doesNotMatch(t, /—/, `${f} uses an em dash`)
  }
})
