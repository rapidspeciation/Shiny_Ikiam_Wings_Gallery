import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { parse } from '@vue/compiler-sfc'
import {
  buildTree, defaultExpansion, expandEverything, flattenTree, extraRows, probIndex, speciesCandidates,
  subspeciesCandidates, regionSpecies, regionSubspecies, genusMembers, keepSelection, treeKeyAction, rankOf,
} from '../src/utils/taxonTree.js'

// A small AI-style prediction: Godyris leads by genus mass while the single
// most likely species sits in Hypothyris.
const pred = {
  genus: [['Godyris', 0.45, 0], ['Hypothyris', 0.38, 0], ['Oleria', 0.08, 0], ['Napeogenes', 0.05, 0], ['Ithomia', 0.02, 0], ['Mechanitis', 0.01, 0]],
  species: [
    ['Hypothyris euclea', 0.34, 0, [['Hypothyris euclea intermedia', 0.3, 0], ['Hypothyris euclea valora', 0.03, 0], ['Hypothyris euclea x', 0.01, 0]]],
    ['Godyris zavaleta', 0.25, 0, [['Godyris zavaleta sosunga', 0.2, 0], ['Godyris zavaleta huallaga', 0.05, 0]]],
    ['Godyris dircenna', 0.2, 0, []],
    ['Oleria onega', 0.08, 0, [['Oleria onega janarilla', 0.08, 0]]],
    ['Hypothyris anastasia', 0.04, 0, []],
  ],
  species_all: [
    ['Hypothyris euclea', 0.34, 0], ['Godyris zavaleta', 0.25, 0], ['Godyris dircenna', 0.2, 0], ['Oleria onega', 0.08, 0],
    ['Hypothyris anastasia', 0.04, 0], ['Godyris panthyale', 0, 0], ['Godyris duillia', 0, 1],
  ],
  subspecies_all: [
    ['Hypothyris euclea intermedia', 0.3, 0], ['Godyris zavaleta sosunga', 0.2, 0], ['Godyris zavaleta huallaga', 0.05, 0],
    ['Hypothyris euclea valora', 0.03, 0], ['Hypothyris euclea x', 0.01, 0], ['Godyris zavaleta caesiopicta', 0, 1],
  ],
}

function vocabState(tree, open, extra = {}) {
  return {
    ...open,
    extraSpecies: (g) => extraRows(speciesCandidates(pred, g.taxon, { mode: 'vocabulary' }), g.species.map((s) => s.taxon), probIndex(pred).species, 'species'),
    extraSubspecies: (s) => extraRows(subspeciesCandidates(pred, s.taxon, { mode: 'vocabulary' }), s.subspecies.map((x) => x.taxon), probIndex(pred).subspecies, 'subspecies'),
    ...extra,
  }
}

test('tree groups species under genera by probability and keeps strong subspecies', () => {
  const tree = buildTree(pred)
  assert.deepEqual(tree.map((g) => g.taxon), ['Godyris', 'Hypothyris', 'Oleria', 'Napeogenes', 'Ithomia', 'Mechanitis'])
  assert.deepEqual(tree[0].species.map((s) => s.taxon), ['Godyris zavaleta', 'Godyris dircenna'])
  // first subspecies always, others only >= 5%
  assert.deepEqual(tree[1].species[0].subspecies.map((s) => s.taxon), ['Hypothyris euclea intermedia'])
  assert.deepEqual(tree[0].species[0].subspecies.map((s) => s.taxon), ['Godyris zavaleta sosunga', 'Godyris zavaleta huallaga'])
  // recorded taxon outside the model output is still listed
  const rec = buildTree(pred, { species: 'Greta andromica', subspecies: 'Greta andromica lyra', evidence: {} })
  const g = rec.find((x) => x.taxon === 'Greta')
  assert.equal(g.species[0].taxon, 'Greta andromica')
  assert.equal(g.species[0].prob, -1)
  assert.equal(g.species[0].subspecies[0].taxon, 'Greta andromica lyra')
})

test('table opens along the most likely path with the next genera collapsed', () => {
  const tree = buildTree(pred)
  const open = defaultExpansion(tree, { topSpecies: 'Hypothyris euclea' })
  assert.deepEqual([...open.genera], ['Godyris', 'Hypothyris'])
  assert.deepEqual([...open.species], ['Godyris zavaleta', 'Hypothyris euclea'])
  const rows = flattenTree(tree, vocabState(tree, open, { genusLimit: 4 }))
  const names = rows.map((r) => `${r.kind}:${r.taxon}`)
  assert.deepEqual(names.slice(0, 6), [
    'genus:Godyris', 'species:Godyris zavaleta', 'subspecies:Godyris zavaleta sosunga', 'subspecies:Godyris zavaleta huallaga',
    'all-subspecies:Godyris zavaleta', 'species:Godyris dircenna',
  ])
  assert.ok(names.includes('subspecies:Hypothyris euclea intermedia'))
  const oleria = rows.find((r) => r.taxon === 'Oleria')
  assert.equal(oleria.open, false)
  assert.equal(rows.some((r) => r.taxon === 'Oleria onega'), false)
  // four genera visible, the rest behind "2 more genera"
  assert.equal(rows.filter((r) => r.kind === 'genus').length, 4)
  const more = rows.at(-1)
  assert.equal(more.kind, 'more-genera')
  assert.equal(more.count, 2)
  const all = flattenTree(tree, vocabState(tree, open, { genusLimit: 4, showAllGenera: true }))
  assert.equal(all.filter((r) => r.kind === 'genus').length, 6)
  // "Show predictions" expands every branch
  const every = expandEverything(tree)
  assert.ok(every.species.has('Oleria onega') && every.genera.has('Mechanitis'))
})

test('all-species and all-subspecies rows list every taxon, including 0%, sorted by probability then name', () => {
  const tree = buildTree(pred)
  const open = defaultExpansion(tree, { topSpecies: 'Hypothyris euclea' })
  let rows = flattenTree(tree, vocabState(tree, open))
  const allSp = rows.find((r) => r.kind === 'all-species' && r.taxon === 'Godyris')
  assert.equal(allSp.count, 4)       // 2 shown + 2 more in the model vocabulary
  open.allSpecies.add('Godyris')
  rows = flattenTree(tree, vocabState(tree, open))
  const extra = rows.filter((r) => r.kind === 'species' && r.extra).map((r) => [r.taxon, r.prob])
  assert.deepEqual(extra, [['Godyris duillia', 0], ['Godyris panthyale', 0]])
  assert.equal(rows.find((r) => r.taxon === 'Godyris duillia').oor, true)   // tagged, not hidden
  open.allSubspecies.add('Godyris zavaleta')
  rows = flattenTree(tree, vocabState(tree, open))
  assert.ok(rows.some((r) => r.taxon === 'Godyris zavaleta caesiopicta' && r.extra && r.prob === 0))
  // unknown to the model (prob -1) goes last, alphabetically
  const sorted = extraRows(['B b', 'A a', 'C c'], [], (t) => (t === 'C c' ? { prob: 0.1, oor: 0 } : null), 'species')
  assert.deepEqual(sorted.map((r) => r.taxon), ['C c', 'A a', 'B b'])
})

test('"+ all" rows only appear on the top path, on branches the user opens, and when they add something', () => {
  const tree = buildTree(pred)
  const open = expandEverything(tree)            // "Show predictions" opens every branch
  const path = defaultExpansion(tree, { topSpecies: 'Hypothyris euclea' }).species
  const rows = flattenTree(tree, vocabState(tree, { ...open }, { showAllGenera: true, browseSpecies: new Set(path) }))
  const allSs = rows.filter((r) => r.kind === 'all-subspecies').map((r) => r.taxon)
  assert.deepEqual(allSs.sort(), ['Godyris zavaleta', 'Hypothyris euclea'])
  // the user opens another species: it may browse too
  const withUser = flattenTree(tree, vocabState(tree, { ...open }, { browseSpecies: new Set([...path, 'Oleria onega']) }))
  assert.equal(withUser.some((r) => r.kind === 'all-subspecies' && r.taxon === 'Oleria onega'), false)   // N <= 1: nothing extra
  // "+ all species" only under open genera, and only when N > 1
  const closed = flattenTree(tree, vocabState(tree, { genera: new Set(), species: new Set() }))
  assert.equal(closed.some((r) => r.kind === 'all-species'), false)
  const one = { genus: [['Solo', 1, 0]], species: [['Solo one', 1, 0, []]], species_all: [['Solo one', 1, 0]] }
  const soloTree = buildTree(one)
  const solo = flattenTree(soloTree, { genera: new Set(['Solo']), species: new Set(),
    extraSpecies: (g) => extraRows(speciesCandidates(one, g.taxon, { mode: 'vocabulary' }), g.species.map((x) => x.taxon), probIndex(one).species, 'species') })
  assert.equal(solo.some((r) => r.kind === 'all-species'), false)
  const oneMore = flattenTree(soloTree, { genera: new Set(['Solo']), species: new Set(), extraSpecies: () => [{ taxon: 'Solo two', prob: 0, subspecies: [] }] })
  assert.equal(oneMore.find((r) => r.kind === 'all-species').count, 2)
})

test('region browsing keeps the old side-of-Andes filter', () => {
  const checklist = {
    'Godyris zavaleta sosunga': { East: 3, West: 0 },
    'Godyris zavaleta caesiopicta': { East: 0, West: 2 },
    'Godyris panthyale': { East: 1, West: 1 },
    'Godyris kedema': { East: 0, West: 0 },
  }
  assert.deepEqual(regionSpecies(checklist, 'Godyris', 'East'), ['Godyris panthyale', 'Godyris zavaleta'])
  assert.deepEqual(regionSpecies(checklist, 'Godyris', ''), ['Godyris panthyale', 'Godyris zavaleta'])
  assert.deepEqual(regionSubspecies(checklist, 'Godyris zavaleta', 'West'), ['Godyris zavaleta caesiopicta'])
  const cands = speciesCandidates({ species_all: [['Godyris dircenna', 0.2, 0]] }, 'Godyris', { mode: 'region', checklist, side: 'West' })
  assert.deepEqual(cands.sort(), ['Godyris dircenna', 'Godyris panthyale', 'Godyris zavaleta'])
})

test('selection: genus members, kept picks, and keyboard movement', () => {
  assert.equal(rankOf('Godyris'), 'genus')
  assert.equal(rankOf('Godyris zavaleta sosunga'), 'subspecies')
  assert.deepEqual(genusMembers(pred, 'Godyris', 3), ['Godyris zavaleta', 'Godyris dircenna', 'Godyris panthyale'])
  assert.equal(keepSelection(pred, '', false), 'Hypothyris euclea')
  assert.equal(keepSelection(pred, 'Godyris panthyale', true), 'Godyris panthyale')   // a 0% taxon the user chose
  assert.equal(keepSelection(pred, 'Godyris', true), 'Godyris')
  assert.equal(keepSelection(pred, 'Godyris panthyale', false), 'Hypothyris euclea')
  assert.equal(keepSelection(pred, 'Nope nope', true), 'Hypothyris euclea')

  // a selection deep in the browse lists opens its branch
  const tree = buildTree(pred)
  const open = defaultExpansion(tree, { selected: 'Godyris zavaleta caesiopicta' })
  assert.ok(open.genera.has('Godyris') && open.species.has('Godyris zavaleta') && open.allSubspecies.has('Godyris zavaleta'))
  assert.ok(defaultExpansion(tree, { selected: 'Godyris panthyale' }).allSpecies.has('Godyris'))

  const rows = flattenTree(tree, vocabState(tree, defaultExpansion(tree, { topSpecies: 'Hypothyris euclea' })))
  assert.deepEqual(treeKeyAction(rows, 'g:Godyris', 'ArrowDown'), { focus: 's:Godyris zavaleta' })
  assert.deepEqual(treeKeyAction(rows, 'g:Godyris', 'ArrowUp'), { focus: 'g:Godyris' })
  assert.deepEqual(treeKeyAction(rows, 'g:Godyris', 'ArrowLeft'), { toggle: true })             // open: collapse
  assert.deepEqual(treeKeyAction(rows, 'g:Godyris', 'ArrowRight'), { focus: 's:Godyris zavaleta' })
  assert.deepEqual(treeKeyAction(rows, 'g:Oleria', 'ArrowRight'), { toggle: true })             // closed: expand
  assert.deepEqual(treeKeyAction(rows, 'ss:Godyris zavaleta sosunga', 'ArrowLeft'), { focus: 's:Godyris zavaleta' })
  assert.deepEqual(treeKeyAction(rows, 's:Godyris dircenna', 'Enter'), { select: true })
  assert.equal(treeKeyAction(rows, 's:Godyris dircenna', 'x'), null)
})

test('a chosen location re-ranks the table and tags off-region taxa instead of hiding them', async () => {
  const vite = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  try {
    const { rankLeaves } = await vite.ssrLoadModule('/src/utils/aiPredict.js')
    const checklist = {
      'Pteronymia ozia': { countries: { Ecuador: 1 }, East: 1, West: 0 },
      'Pteronymia alissa': { countries: { Ecuador: 1 }, East: 0, West: 1 },
      'Dircenna dero': { countries: { Ecuador: 1 }, East: 0, West: 1 },
    }
    const leaves = [['Pteronymia ozia tanampaya', 0.5], ['Pteronymia alissa', 0.01], ['Dircenna dero', 0.49]]
    const any = rankLeaves(leaves, checklist, {})
    assert.equal(buildTree(any)[0].taxon, 'Pteronymia')
    assert.equal(any.species.some((s) => s[2]), false)       // no location: no tags
    // a country where Pteronymia ozia is not recorded demotes it (x0.3)
    const co = buildTree(rankLeaves(leaves, { ...checklist, 'Dircenna dero': { countries: { Ecuador: 1, Colombia: 1 }, East: 0, West: 1 } }, { country: 'Colombia' }))
    assert.equal(co[0].taxon, 'Dircenna')
    // side of the Andes tags off-region taxa but does not re-rank
    const west = rankLeaves(leaves, checklist, { country: 'Ecuador', side: 'West' })
    const tree = buildTree(west)
    assert.equal(tree[0].taxon, 'Pteronymia')
    const ozia = tree.find((g) => g.taxon === 'Pteronymia').species.find((s) => s.taxon === 'Pteronymia ozia')
    assert.equal(ozia.oor, true)
    assert.equal(ozia.subspecies[0].oor, true)
    // the full lists behind "+ all" rows carry the same flags
    assert.ok(west.subspecies_all.find((s) => s[0] === 'Pteronymia ozia tanampaya')[2])
    assert.equal(west.genus_all.length, 2)
  } finally { await vite.close() }
})

test('both tabs use the shared table without per-row guide buttons', () => {
  const tree = parse(readFileSync('src/components/TaxonTree.vue', 'utf8')).descriptor
  assert.match(tree.template.content, /role="tree"/)
  assert.match(tree.template.content, /role="treeitem"/)
  assert.match(tree.template.content, /:aria-selected=/)
  assert.match(tree.template.content, /loading="lazy"/)
  assert.doesNotMatch(tree.template.content, /src-chip|SOURCE_LABELS/)
  assert.match(tree.scriptSetup.content, /IntersectionObserver/)
  const panel = parse(readFileSync('src/components/PredictionPanel.vue', 'utf8')).descriptor
  assert.match(panel.template.content, /<TaxonTree[^>]*badges/)
  assert.doesNotMatch(panel.template.content, /src-chip|chipsFor/)
  const ai = parse(readFileSync('src/components/AIIdTab.vue', 'utf8')).descriptor
  assert.match(ai.template.content, /<TaxonTree[^>]*browse="vocabulary"[^>]*thumbs/)
  assert.match(ai.template.content, /:members="selectedMembers"/)
  const app = readFileSync('src/App.vue', 'utf8')
  assert.match(app, /<TaxonDrawer \/>/)
  const drawer = parse(readFileSync('src/components/TaxonDrawer.vue', 'utf8')).descriptor
  assert.match(drawer.template.content, /role="dialog" aria-modal="true"/)
  assert.match(drawer.template.content, /<AIReferencePanel/)
  for (const f of ['src/components/TaxonTree.vue', 'src/components/TaxonDrawer.vue', 'src/components/AILocationChips.vue']) {
    assert.doesNotMatch(parse(readFileSync(f, 'utf8')).descriptor.template.content, /—/, `${f} uses an em dash`)
  }
})

test('tapping a collapsed row only expands it; the photo sheet waits for an open row or leaf', () => {
  const src = readFileSync('src/components/TaxonTree.vue', 'utf8')
  const choose = src.slice(src.indexOf('function choose('), src.indexOf('function onKey('))
  assert.match(choose, /const opening = r\.expandable && !r\.open/)
  assert.match(choose, /if \(!opening\) emit\('activate', r\.taxon\)/)
  assert.match(choose, /emit\('select', r\.taxon\)/)
})
