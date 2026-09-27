// Pure logic behind the shared taxonomy table (TaxonTree.vue), used by the
// Collection cards and the AI Identifier. It keeps the rules of the older
// PredictionPanel tree: genera ordered by genus probability, species under their
// genus by probability, the first subspecies always plus any other >= 5%, the
// recorded taxon always present, and "+ all" rows that browse every taxon of a
// genus or species (sorted by probability, then name). No I/O, unit tested in
// tests/taxon-tree.test.mjs.
import { fmtPct } from './aiCandidates.js'

export const SUBSP_MIN = 0.05        // show the 2nd/3rd subspecies only if >= 5%
export const GENUS_LIMIT = 4         // genera visible before the "N more genera" row

export const genusOf = (t) => String(t || '').trim().split(/\s+/)[0] || ''
export const speciesOf = (t) => String(t || '').trim().split(/\s+/).slice(0, 2).join(' ')
export const rankOf = (t) => {
  const n = String(t || '').trim().split(/\s+/).filter(Boolean).length
  return n >= 3 ? 'subspecies' : n === 2 ? 'species' : n === 1 ? 'genus' : ''
}
export { fmtPct }

// Probability first (unknown = -1 goes last), then name.
export const byProbThenName = (a, b) => (b.prob - a.prob) || a.taxon.localeCompare(b.taxon)

// ---- region checklist browsing (same rules as the old "+ all" buttons) ----
// side 'East' / 'West' keeps taxa recorded on that side of the Andes; '' keeps
// taxa recorded on either side.
export function onSide(entry, side) {
  if (!entry) return false
  if (side === 'East') return entry.East > 0
  if (side === 'West') return entry.West > 0
  return entry.East > 0 || entry.West > 0
}
// Memoised per checklist object: many cards ask for the same genus.
const _memo = new WeakMap()
function memo(checklist, key, fn) {
  let m = _memo.get(checklist)
  if (!m) { m = new Map(); _memo.set(checklist, m) }
  if (!m.has(key)) m.set(key, fn())
  return m.get(key)
}
export function regionSpecies(checklist, genus, side) {
  if (!genus || !checklist) return []
  return memo(checklist, `sp|${genus}|${side || ''}`, () => scanSpecies(checklist, genus, side))
}
function scanSpecies(checklist, genus, side) {
  const prefix = `${genus} `
  const set = new Set()
  for (const k in checklist) {
    if (!k.startsWith(prefix) || !onSide(checklist[k], side)) continue
    const p = k.split(/\s+/)
    if (p.length >= 2) set.add(`${p[0]} ${p[1]}`)
  }
  return [...set].sort()
}
export function regionSubspecies(checklist, species, side) {
  if (!species || !checklist) return []
  return memo(checklist, `ss|${species}|${side || ''}`, () => scanSubspecies(checklist, species, side))
}
function scanSubspecies(checklist, species, side) {
  const prefix = `${species} `
  const out = []
  for (const k in checklist) {
    if (k.startsWith(prefix) && k.split(/\s+/).length === 3 && onSide(checklist[k], side)) out.push(k)
  }
  return out.sort()
}

// ---- tree ----------------------------------------------------------------
// pred: { genus:[[g,p,oor]], species:[[sp,p,oor,[[ssp,p,oor]]]], ... }
// recorded (Collection only): { species, subspecies, evidence: { genus, species,
// subspecies } } where evidence rows are { confidence, oor } or null.
// -> [{ taxon, rank:'genus', prob, oor, species:[{ taxon, rank, prob, oor, subspecies:[...] }] }]
export function buildTree(pred, recorded = null) {
  if (!pred) return []
  const genusArr = pred.genus || []
  const speciesArr = pred.species || []
  const genusProb = new Map(), genusOor = new Map()
  for (const [g, p, oor] of genusArr) if (!genusProb.has(g)) { genusProb.set(g, p); genusOor.set(g, !!oor) }

  const all = new Set(genusProb.keys())
  for (const [sp] of speciesArr) all.add(genusOf(sp))
  const ordered = [...all].sort((a, b) => {
    const pa = genusProb.has(a), pb = genusProb.has(b)
    if (pa && pb) return genusProb.get(b) - genusProb.get(a)
    if (pa) return -1
    if (pb) return 1
    return a.localeCompare(b)
  })

  const tree = ordered.map((g) => ({
    taxon: g,
    rank: 'genus',
    prob: genusProb.has(g) ? genusProb.get(g) : null,
    oor: !!genusOor.get(g),
    species: speciesArr
      .filter(([sp]) => genusOf(sp) === g)
      .map(([sp, p, oor, subs]) => ({
        taxon: sp,
        rank: 'species',
        prob: p,
        oor: !!oor,
        subspecies: (subs || [])
          .filter((x, i) => i === 0 || x[1] >= SUBSP_MIN)
          .map(([t, p2, o]) => ({ taxon: t, rank: 'subspecies', prob: p2, oor: !!o })),
      }))
      .sort((a, b) => b.prob - a.prob),
  }))

  // The recorded taxon is always present, even outside the model's top-k.
  const recSp = recorded?.species
  if (recSp) {
    const ev = recorded.evidence || {}
    const g = genusOf(recSp)
    let gNode = tree.find((x) => x.taxon === g)
    if (!gNode) {
      gNode = { taxon: g, rank: 'genus', prob: ev.genus?.confidence ?? null, oor: ev.genus?.oor === true, species: [] }
      tree.push(gNode)
    }
    let sNode = gNode.species.find((x) => x.taxon === recSp)
    if (!sNode) {
      sNode = { taxon: recSp, rank: 'species', prob: ev.species?.confidence ?? -1, oor: ev.species?.oor === true, subspecies: [] }
      gNode.species.push(sNode)
      gNode.species.sort((a, b) => b.prob - a.prob)
    }
    const recSs = recorded.subspecies
    if (recSs && !sNode.subspecies.find((x) => x.taxon === recSs)) {
      sNode.subspecies.push({ taxon: recSs, rank: 'subspecies', prob: ev.subspecies?.confidence ?? -1, oor: ev.subspecies?.oor === true })
    }
  }
  return tree
}

// Branches opened by default: the top genus with its top species (showing its
// subspecies), the model's top species call (its genus can differ from the top
// genus by mass), the recorded taxon and the current selection.
export function defaultExpansion(tree, { topSpecies = '', recordedSpecies = '', selected = '' } = {}) {
  const genera = new Set(), species = new Set()
  if (tree.length) {
    genera.add(tree[0].taxon)
    if (tree[0].species.length) species.add(tree[0].species[0].taxon)
  }
  const reveal = (sp) => {
    if (!sp) return
    const lc = sp.toLowerCase()
    for (const g of tree) for (const s of g.species) {
      if (s.taxon.toLowerCase() === lc) { genera.add(g.taxon); species.add(s.taxon) }
    }
  }
  reveal(topSpecies)
  reveal(recordedSpecies)
  const allSpecies = new Set(), allSubspecies = new Set()
  if (selected) {
    const rank = rankOf(selected)
    const g = genusOf(selected), sp = speciesOf(selected)
    const gNode = tree.find((x) => x.taxon === g)
    if (gNode && rank !== 'genus') {
      genera.add(g)
      const sNode = gNode.species.find((x) => x.taxon === sp)
      if (!sNode) allSpecies.add(g)
      if (rank === 'subspecies') {
        species.add(sp)
        if (!sNode || !sNode.subspecies.some((x) => x.taxon === selected)) allSubspecies.add(sp)
      }
    }
  }
  return { genera, species, allSpecies, allSubspecies }
}

export function expandEverything(tree) {
  const genera = new Set(), species = new Set()
  for (const g of tree) { genera.add(g.taxon); for (const s of g.species) species.add(s.taxon) }
  return { genera, species }
}

// Rows for "+ all species in <genus>" / "+ all subspecies": every candidate
// name not already shown, with the model's probability when it has one
// (prob -1 = not in the model output), sorted by probability then name.
// probOf(name) -> { prob, oor } | null
export function extraRows(candidates, shown, probOf, rank) {
  const seen = new Set(shown)
  const out = []
  for (const taxon of candidates) {
    if (seen.has(taxon)) continue
    seen.add(taxon)
    const hit = probOf(taxon)
    out.push({ taxon, rank, prob: hit ? hit.prob : -1, oor: hit ? !!hit.oor : false, subspecies: [], extra: true })
  }
  return out.sort(byProbThenName)
}

// Candidate names for the "+ all" rows.
//   'vocabulary' (AI Identifier): every species / subspecies the model knows,
//     taken from the full re-ranked distribution (species_all, subspecies_all),
//     so 0% taxa are listed and off-region ones are tagged, not hidden.
//   'region' (Collection): taxa of the region checklist on the specimen's side of
//     the Andes, as the old tree did, plus any the prediction scored.
export function speciesCandidates(pred, genus, { mode = 'region', checklist = null, side = '' } = {}) {
  const prefix = `${genus} `
  const fromPred = (pred?.species_all || pred?.species || []).map((r) => r[0]).filter((t) => t.startsWith(prefix))
  if (mode === 'vocabulary') return fromPred
  return [...new Set([...regionSpecies(checklist, genus, side), ...fromPred])]
}
export function subspeciesCandidates(pred, species, { mode = 'region', checklist = null, side = '' } = {}) {
  const prefix = `${species} `
  const fromPred = (pred?.subspecies_all || pred?.subspecies || []).map((r) => r[0])
    .filter((t) => t.startsWith(prefix) && t.split(/\s+/).length >= 3)
  if (mode === 'vocabulary') return fromPred
  return [...new Set([...regionSubspecies(checklist, species, side), ...fromPred])]
}

// name -> { prob, oor } lookups over the prediction's longest lists.
export function probIndex(pred) {
  const sp = new Map(), ss = new Map(), ge = new Map()
  for (const [t, p, o] of pred?.genus_all || pred?.genus || []) if (!ge.has(t)) ge.set(t, { prob: p, oor: !!o })
  for (const [t, p, o] of pred?.species_all || pred?.species || []) if (!sp.has(t)) sp.set(t, { prob: p, oor: !!o })
  for (const [t, p, o] of pred?.subspecies_all || pred?.subspecies || []) if (!ss.has(t)) ss.set(t, { prob: p, oor: !!o })
  for (const [, , , subs] of pred?.species || []) for (const [t, p, o] of subs || []) if (!ss.has(t)) ss.set(t, { prob: p, oor: !!o })
  return {
    genus: (t) => ge.get(t) || null,
    species: (t) => sp.get(t) || null,
    subspecies: (t) => ss.get(t) || null,
    any: (t) => ({ genus: ge, species: sp, subspecies: ss }[rankOf(t)]?.get(t) || null),
  }
}

// Flatten the tree into the visible rows, in display order.
// state: { genera, species, allSpecies, allSubspecies (Sets), showAllGenera,
//   genusLimit, keepGenera (Set of genera always visible), browseSpecies (Set of
//   species that may offer "+ all subspecies": the top path and species the user
//   opened; omit to allow every open species), extraSpecies(gNode),
//   extraSubspecies(sNode) -> rows }
// "+ all" rows only appear under open branches, and only when they would list
// more than one taxon.
// Row kinds: genus | species | subspecies | all-species | all-subspecies | more-genera.
export function flattenTree(tree, state) {
  const {
    genera, species, allSpecies = new Set(), allSubspecies = new Set(),
    showAllGenera = false, genusLimit = GENUS_LIMIT, keepGenera = new Set(), browseSpecies = null,
    extraSpecies = () => [], extraSubspecies = () => [],
  } = state
  const rows = []
  const visible = tree.filter((g, i) => showAllGenera || i < genusLimit || keepGenera.has(g.taxon))
  const hidden = tree.length - visible.length

  const pushSpecies = (s, gKey, extra) => {
    const key = `s:${s.taxon}`
    const more = extraSubspecies(s)
    const open = species.has(s.taxon)
    const row = { key, kind: 'species', level: 2, taxon: s.taxon, rank: 'species', prob: s.prob, oor: s.oor, extra,
      parent: gKey, expandable: s.subspecies.length > 0 || s.subspecies.length + more.length > 1, open }
    rows.push(row)
    if (!open) return
    const before = rows.length
    for (const ss of s.subspecies) {
      rows.push({ key: `ss:${ss.taxon}`, kind: 'subspecies', level: 3, taxon: ss.taxon, rank: 'subspecies', prob: ss.prob, oor: ss.oor, extra, parent: key })
    }
    const showMore = allSubspecies.has(s.taxon)
    if (showMore) for (const ss of more) {
      rows.push({ key: `ss:${ss.taxon}`, kind: 'subspecies', level: 3, taxon: ss.taxon, rank: 'subspecies', prob: ss.prob, oor: ss.oor, extra: true, parent: key })
    }
    const count = s.subspecies.length + more.length
    if (more.length && count > 1 && (showMore || !browseSpecies || browseSpecies.has(s.taxon))) {
      rows.push({ key: `as:${s.taxon}`, kind: 'all-subspecies', level: 3, taxon: s.taxon, open: showMore, count, parent: key })
    }
    if (rows.length === before) row.open = false   // nothing to show under it: display as closed
  }

  for (const g of visible) {
    const key = `g:${g.taxon}`
    const more = extraSpecies(g)
    const open = genera.has(g.taxon)
    rows.push({ key, kind: 'genus', level: 1, taxon: g.taxon, rank: 'genus', prob: g.prob, oor: g.oor, extra: false,
      parent: null, expandable: g.species.length > 0 || g.species.length + more.length > 1, open })
    if (!open) continue
    for (const s of g.species) pushSpecies(s, key, false)
    const showMore = allSpecies.has(g.taxon)
    if (showMore) for (const s of more) pushSpecies(s, key, true)
    const count = g.species.length + more.length
    if (more.length && count > 1) {
      rows.push({ key: `ag:${g.taxon}`, kind: 'all-species', level: 2, taxon: g.taxon, open: showMore, count, parent: key })
    }
  }
  if (hidden > 0 || (showAllGenera && tree.length > genusLimit)) {
    rows.push({ key: 'more-genera', kind: 'more-genera', level: 1, taxon: '', open: showAllGenera, count: hidden, parent: null })
  }
  return rows
}

// Keyboard behaviour of the table (tree pattern). Returns what to do for a key
// on row `key`: { focus: rowKey } | { toggle: true } | { select: true } | null.
//   Up / Down / Home / End move focus; Right expands (or steps into an open row);
//   Left collapses (or moves to the parent row); Enter / Space select.
export function treeKeyAction(rows, key, keyName) {
  const i = rows.findIndex((r) => r.key === key)
  if (i < 0) return rows.length ? { focus: rows[0].key } : null
  const r = rows[i]
  switch (keyName) {
    case 'ArrowDown': return { focus: rows[Math.min(rows.length - 1, i + 1)].key }
    case 'ArrowUp': return { focus: rows[Math.max(0, i - 1)].key }
    case 'Home': return { focus: rows[0].key }
    case 'End': return { focus: rows[rows.length - 1].key }
    case 'ArrowRight':
      if (r.expandable && !r.open) return { toggle: true }
      if (r.expandable && rows[i + 1]) return { focus: rows[i + 1].key }
      return null
    case 'ArrowLeft':
      if (r.expandable && r.open) return { toggle: true }
      if (r.parent) return { focus: r.parent }
      return null
    case 'Enter':
    case ' ':
      return { select: true }
    default: return null
  }
}

// Top species of a genus (for a genus selection's representative photos).
export function genusMembers(pred, genus, n = 3) {
  const prefix = `${genus} `
  return (pred?.species_all || pred?.species || [])
    .filter((r) => r[0].startsWith(prefix))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map((r) => r[0])
}

// Keep a user-picked taxon while the prediction still knows it; otherwise
// follow the model's top species.
export function keepSelection(pred, current, userPicked = false) {
  const top = pred?.species?.[0]?.[0] || ''
  if (current && userPicked && probIndex(pred).any(current)) return current
  return top
}
