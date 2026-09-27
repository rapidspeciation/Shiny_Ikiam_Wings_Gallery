import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { parse } from '@vue/compiler-sfc'
import {
  speciesCandidates, formatGenusSummary, taxonInfo, pickSelection, stepSelection, candidateOrder, fmtPct, SUBSP_CHIP_MIN,
} from '../src/utils/aiCandidates.js'

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

test('species-first candidates come from the (re-ranked) species marginals with subspecies chips', async () => {
  const { vite, mod } = await loadPredict()
  try {
    const any = mod.rankLeaves(leaves, checklist, { topK: 10 })
    assert.equal(any.species.length, 10)
    const top5 = speciesCandidates(any, 5)
    assert.deepEqual(top5.slice(0, 3).map((c) => c.taxon), ['Pteronymia ozia', 'Dircenna dero', 'Godyris zavaleta'])
    assert.ok(Math.abs(top5[0].prob - 0.4) < 1e-3)
    // only subspecies >= 5% become chips
    assert.deepEqual(top5[0].subspecies.map((s) => [s.epithet, s.prob]), [['tanampaya', 0.36]])
    assert.ok(top5[0].subspecies.every((s) => s.prob >= SUBSP_CHIP_MIN))
    assert.equal(speciesCandidates(any, 10).length, 10)
    assert.equal(top5.some((c) => c.oor), false)
    // geographic re-rank: West of Andes demotes Pteronymia ozia (East only)
    const west = mod.rankLeaves(leaves, checklist, { country: 'Ecuador', side: 'West', topK: 10 })
    const w = speciesCandidates(west, 10)
    assert.equal(w[0].taxon, 'Dircenna dero')
    assert.equal(w.find((c) => c.taxon === 'Pteronymia ozia').oor, true)
    assert.equal(west.species_all.find((c) => c[0] === 'Godyris zavaleta')[2], 1)
    // default topK is unchanged for other callers
    assert.equal(mod.rankLeaves(leaves, checklist).species.length, 8)
  } finally { await vite.close() }
})

test('genus summary, taxon lookup and percent formatting', () => {
  const pred = { genus: [['Pteronymia', 0.52], ['Dircenna', 0.07], ['Godyris', 0.05], ['Oleria', 0.04], ['Hypoleria', 0.01]],
    species: [['Pteronymia ozia', 0.4, 0, [['Pteronymia ozia tanampaya', 0.36, 1]]]], species_all: [['Pteronymia ozia', 0.4, 0], ['Oleria onega', 0.002, 0]] }
  assert.equal(formatGenusSummary(pred), 'Pteronymia 52% · Dircenna 7% · Godyris 5% · Oleria 4% · …')
  assert.equal(formatGenusSummary({ genus: [['Pteronymia', 1]] }), 'Pteronymia 100%')
  assert.deepEqual(taxonInfo(pred, 'Pteronymia ozia tanampaya'), { taxon: 'Pteronymia ozia tanampaya', prob: 0.36, oor: true, rank: 'subspecies' })
  assert.equal(taxonInfo(pred, 'Oleria onega').prob, 0.002)
  assert.equal(taxonInfo(pred, 'Nope nope'), null)
  assert.equal(fmtPct(0.002), '<1%')
  assert.equal(fmtPct(0), '0%')
  assert.equal(fmtPct(0.364), '36%')
})

test('selection defaults to the first species, keeps user picks, and arrows move through the list', () => {
  const cands = [
    { taxon: 'A a', subspecies: [{ taxon: 'A a x' }] },
    { taxon: 'B b', subspecies: [] },
  ]
  assert.deepEqual(candidateOrder(cands), ['A a', 'A a x', 'B b'])
  assert.equal(pickSelection(cands, ''), 'A a')
  assert.equal(pickSelection(cands, 'B b', false), 'A a')   // not user-picked: follow the top
  assert.equal(pickSelection(cands, 'B b', true), 'B b')
  assert.equal(pickSelection(cands, 'C c', true), 'A a')    // gone after re-rank
  assert.equal(pickSelection([], 'A a', true), '')
  assert.equal(stepSelection(cands, 'A a', 1), 'A a x')
  assert.equal(stepSelection(cands, 'A a x', 1), 'B b')
  assert.equal(stepSelection(cands, 'B b', 1), 'B b')
  assert.equal(stepSelection(cands, 'A a', -1), 'A a')
  assert.equal(stepSelection(cands, 'missing', 1), 'A a')
})

test('results view wiring: tabs, listbox, reference tabs and no licence text', () => {
  const tab = parse(readFileSync('src/components/AIIdTab.vue', 'utf8')).descriptor
  assert.match(tab.template.content, /role="tablist" aria-label="Your photos"/)
  assert.match(tab.template.content, /role="dialog" aria-modal="true"/)
  assert.match(tab.scriptSetup.content, /topK: TOP_SPECIES/)
  assert.doesNotMatch(tab.template.content, /PredictionPanel|AIReferenceGallery/)
  const list = parse(readFileSync('src/components/AICandidateList.vue', 'utf8')).descriptor
  assert.match(list.template.content, /role="listbox"/)
  assert.match(list.template.content, /role="option"[^>]*:aria-selected/)
  assert.match(list.template.content, /loading="lazy"/)
  const panel = parse(readFileSync('src/components/AIReferencePanel.vue', 'utf8')).descriptor
  assert.match(panel.scriptSetup.content, /const tab = ref\('field'\)/)   // Field photos is the default tab
  assert.match(panel.template.content, /Field photos \(/)
  assert.match(panel.template.content, /Museum \(/)
  assert.match(panel.template.content, /View on iNaturalist ↗/)
  for (const src of [panel.template.content, readFileSync('src/utils/inatPhotos.js', 'utf8'), readFileSync('src/utils/aiReference.js', 'utf8')]) {
    assert.doesNotMatch(src, /licen[cs]e|CC BY/i)
  }
  for (const f of ['src/components/AIIdTab.vue', 'src/components/AICandidateList.vue', 'src/components/AIReferencePanel.vue']) {
    // results UI only (the About copy is maintained separately)
    const t = parse(readFileSync(f, 'utf8')).descriptor.template.content.split('<!-- About (simplified) -->')[0]
    assert.doesNotMatch(t, /—/, `${f} uses an em dash`)
  }
})
