// Taxonomy name map (public/data/taxon_name_map.json): old model / checklist /
// collection names -> corrected names from the 27 September 2026 taxonomy vetting
// (species merges and renames, spelling fixes, subspecies merges).
//   { species: { old: new }, leaves: { old leaf: new leaf } }
// The map is many-to-one (two old names can merge into one) and has no chains.
//
// The site's data files (region checklist, collection records, guide links) keep
// the OLD names, while the served single-photo head may return either. Lookups go
// through lookupOrder(): the requested name first, then its canonical name and
// every old name that maps to it, so results are the same for old and new names.
// No I/O except loadTaxonNames(); unit tested in tests/taxon-names.test.mjs.

const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ')
const genusOf = (t) => t.split(' ')[0]
const speciesOf = (t) => t.split(' ').slice(0, 2).join(' ')

function build(map) {
  const species = { ...(map?.species || {}) }
  const leaves = { ...(map?.leaves || {}) }
  const inverse = new Map()      // new name -> Set(old names), species and leaves
  const spInverse = new Map()    // new species -> Set(old species)
  const genusInverse = new Map() // new genus -> Set(old genera whose species moved into it)
  const add = (m, from, to) => {
    if (!from || !to || from === to) return
    if (!m.has(to)) m.set(to, new Set())
    m.get(to).add(from)
  }
  for (const [o, n] of Object.entries(species)) {
    add(inverse, o, n)
    add(spInverse, o, n)
    add(genusInverse, genusOf(o), genusOf(n))
  }
  for (const [o, n] of Object.entries(leaves)) add(inverse, o, n)
  return { species, leaves, inverse, spInverse, genusInverse }
}

let state = build(null)
let version = 0
let loading = null

// Replace the map (tests, or a preloaded copy). Marks the map as loaded.
export function setTaxonNameMap(map) {
  state = build(map)
  version += 1
  loading = Promise.resolve(true)
}
// Bumps whenever the map changes (for memoised lookups).
export const taxonNamesVersion = () => version

// Fetch the map once. Never rejects: without the file every name maps to itself.
export function loadTaxonNames({ fetchImpl = (...a) => globalThis.fetch(...a), url = null } = {}) {
  if (loading) return loading
  const base = import.meta.env?.BASE_URL ?? '/'
  loading = Promise.resolve()
    .then(() => fetchImpl(url || `${base}data/taxon_name_map.json`))
    .then((r) => (r.ok ? r.json() : null))
    .then((map) => {
      if (map && (map.species || map.leaves)) { state = build(map); version += 1 }
      return true
    })
    .catch(() => false)
  return loading
}

// Old -> new for species, leaves (subspecies) and trinomials of renamed species;
// identity otherwise (genera are never renamed on their own).
export function canonical(name) {
  const t = clean(name)
  if (!t) return t
  if (Object.hasOwn(state.leaves, t)) return state.leaves[t]
  if (Object.hasOwn(state.species, t)) return state.species[t]
  const p = t.split(' ')
  if (p.length >= 3) {
    const sp = `${p[0]} ${p[1]}`
    if (Object.hasOwn(state.species, sp)) return `${state.species[sp]} ${p.slice(2).join(' ')}`
  }
  return t
}

// Every old name that maps to the canonical form of `name` (sorted, without it).
export function aliasesOf(name) {
  const c = canonical(name)
  if (!c) return []
  const out = new Set(state.inverse.get(c) || [])
  const p = c.split(' ')
  if (p.length >= 3) {
    const rest = p.slice(2).join(' ')
    for (const old of state.spInverse.get(speciesOf(c)) || []) {
      const cand = `${old} ${rest}`
      if (canonical(cand) === c) out.add(cand)
    }
  }
  out.delete(c)
  return [...out].sort()
}

// Names to try for a lookup: the requested name, then its canonical name, then
// the other old names that merged into it.
export function lookupOrder(name) {
  const t = clean(name)
  if (!t) return []
  return [...new Set([t, canonical(t), ...aliasesOf(t)])]
}

// Checklist keys for a taxon: lookupOrder plus, for a genus, the old genera whose
// species moved into it (e.g. Dione <- Agraulis), so a renamed genus keeps the
// distribution of the species it received.
export function checklistNames(name) {
  const names = lookupOrder(name)
  if (names.length === 1 && !names[0].includes(' ')) {
    for (const g of state.genusInverse.get(names[0]) || []) names.push(g)
  }
  return names
}

// Old names shown as "formerly ..." for a taxon displayed under its canonical
// name ([] for a name that is itself old, or has no aliases).
export function formerNames(name) {
  const t = clean(name)
  return t && canonical(t) === t ? aliasesOf(t) : []
}
export function formerlyText(name, max = 2) {
  const f = formerNames(name)
  if (!f.length) return ''
  const shown = f.slice(0, max).join(', ')
  return f.length > max ? `formerly ${shown} and ${f.length - max} more` : `formerly ${shown}`
}

// Rename model leaves to canonical names, summing probabilities of merged leaves.
// Order follows the first occurrence of each canonical name.
export function canonicalLeaves(leaves) {
  const out = new Map()
  for (const [name, p] of leaves || []) {
    const c = canonical(name)
    out.set(c, (out.get(c) || 0) + p)
  }
  return [...out.entries()]
}

// Try `fn(name)` for each name in lookupOrder(taxon) until `isHit(result)`.
// -> { value, name } (name = the name that hit), or { value: last, name: '' }.
export async function firstHit(taxon, fn, isHit = (v) => v != null) {
  let last = null
  for (const name of lookupOrder(taxon)) {
    last = await fn(name)
    if (isHit(last)) return { value: last, name }
  }
  return { value: last, name: '' }
}
