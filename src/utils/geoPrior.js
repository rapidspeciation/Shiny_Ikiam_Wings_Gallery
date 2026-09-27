// Client-side geographic prior for the AI ID tab. Re-ranks the model's raw
// per-leaf probabilities: taxa not recorded in the chosen country are down-weighted
// (x eps). Country records are the region checklist merged with GBIF country
// presence (mergeGbifPresence), because the checklist alone misses many true
// occurrences: on the field benchmark it marked the true species absent from its
// own country for 44.5% of photos and a hard x0.02 penalty cut Top-1 from 86.0% to
// 73.5%. The merged records with x0.3 gave 86.7% (reports/geo_prior_audit_20260927).
// Side of the Andes only drives the off-region tag; it no longer re-ranks, since
// it lowered accuracy in every Ecuador zone. Never up-weights.
import { getChecklist } from '../composables/useCurationData.js'
import { checklistNames, taxonNamesVersion } from './taxonNames.js'

export const DEFAULT_EPS = 0.3

// Look up a taxon's checklist entry, falling back trinomial -> binomial. The
// checklist keeps the old names, so each level also tries the canonical name and
// its aliases (taxonNames.js); when several keys match (a merge, e.g. Dryas julia
// + Dryas iulia) their records are combined.
export function entryFor(checklist, taxon) {
  if (!taxon || !checklist) return null
  const e = lookupEntry(checklist, taxon)
  if (e) return e
  const p = String(taxon).trim().split(/\s+/)
  return p.length >= 3 ? lookupEntry(checklist, `${p[0]} ${p[1]}`) : null
}

const _merged = new WeakMap()   // checklist -> { version, map: name -> merged entry }
function lookupEntry(checklist, name) {
  const names = checklistNames(name)
  if (names.length <= 1) return checklist[names[0] ?? name] || null
  let m = _merged.get(checklist)
  if (!m || m.version !== taxonNamesVersion()) { m = { version: taxonNamesVersion(), map: new Map() }; _merged.set(checklist, m) }
  const key = names.join('|')
  if (!m.map.has(key)) {
    const hits = names.map((n) => checklist[n]).filter(Boolean)
    m.map.set(key, hits.length > 1 ? mergeEntries(hits) : hits[0] || null)
  }
  return m.map.get(key)
}

// Union of checklist records: counts add up per country and side.
export function mergeEntries(entries) {
  const out = { East: 0, West: 0, countries: {} }
  for (const e of entries) {
    out.East += e.East || 0
    out.West += e.West || 0
    if (e.ec) out.ec = Math.max(out.ec || 0, e.ec)
    for (const [c, n] of Object.entries(e.countries || {})) out.countries[c] = (out.countries[c] || 0) + n
  }
  return out
}

// weight in (eps, 1]. country '' / 'Any' = no country filter. `side` is accepted for
// compatibility but does not change the weight (see the header comment).
export function geoWeight(entry, country, side, eps = DEFAULT_EPS) {
  if (!entry) return 1 // unknown to the checklist -> never penalise
  if (country && country !== 'Any') {
    const inCountry = entry.countries && entry.countries[country] > 0
    if (!inCountry) return eps
  }
  return 1
}

// Whether a taxon is "off-region" for the chosen location (drives the tag): not
// recorded in the country, or, for a chosen side of the Andes, not recorded there.
export function isOffRegion(checklist, taxon, country, side, eps = DEFAULT_EPS) {
  const e = entryFor(checklist, taxon)
  if (geoWeight(e, country, side, eps) < 1) return true
  return !!e && (side === 'East' || side === 'West') && !(e[side] > 0)
}

// Add GBIF country presence ({ species: { "Genus species": [country, ...] } }, current
// names) to a checklist keyed by (older) names. Each species' countries are added to
// its own key and to every checklist subspecies key of that species, so trinomial
// lookups see them too. `canonical` maps checklist names to current names.
export function mergeGbifPresence(checklist, presence, canonical = (n) => n) {
  const bySpecies = (presence && presence.species) || {}
  const out = { ...checklist }
  const add = (key, countries) => {
    const e = out[key] ? { ...out[key], countries: { ...(out[key].countries || {}) } } : { East: 0, West: 0, countries: {} }
    for (const c of countries) e.countries[c] = (e.countries[c] || 0) + 1
    out[key] = e
  }
  for (const [sp, countries] of Object.entries(bySpecies)) add(sp, countries)
  for (const key of Object.keys(checklist)) {
    const p = key.split(/\s+/)
    if (p.length < 3) continue
    const sp = canonical(`${p[0]} ${p[1]}`).split(/\s+/).slice(0, 2).join(' ')
    if (bySpecies[sp]) add(key, bySpecies[sp])
  }
  return out
}

// Guess the most likely region from the model's RAW (un-weighted) leaf
// probabilities, by asking the checklist where those taxa actually occur:
//   score(region) = Σ_leaf  P(leaf) · 1[leaf documented in region]
// Returns { country, countryConf, side, sideConf } — '' when undecidable. Used
// for the "I don't know — guess from photo" option. Side is only inferred among
// leaves present in the guessed country (defaults to Ecuador), since the East/
// West split is an Ecuador concept here.
export function guessRegion(checklist, rawLeaves, topN = 6) {
  const total = rawLeaves.reduce((a, [, p]) => a + p, 0) || 1
  const countryMass = new Map()
  for (const [name, p] of rawLeaves) {
    const e = entryFor(checklist, name)
    if (!e || !e.countries) continue
    for (const c in e.countries) {
      if (e.countries[c] > 0) countryMass.set(c, (countryMass.get(c) || 0) + p)
    }
  }
  // Ranked list of the countries the top predictions are recorded from
  // (share of prediction mass documented in each), so the user can see and pick.
  const countries = [...countryMass.entries()]
    .map(([name, m]) => [name, m / total])
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
  const country = countries[0]?.[0] || ''
  const countryConf = countries[0]?.[1] || 0

  // Side: weigh East vs West among leaves present in the guessed country.
  const sideCountry = country || 'Ecuador'
  let east = 0, west = 0
  for (const [name, p] of rawLeaves) {
    const e = entryFor(checklist, name)
    if (!e) continue
    const inCountry = !e.countries || e.countries[sideCountry] > 0
    if (!inCountry) continue
    if (e.East > 0) east += p
    if (e.West > 0) west += p
  }
  let side = '', sideConf = 0
  const sideSum = east + west
  if (sideSum > 0) {
    side = east >= west ? 'East' : 'West'
    sideConf = Math.max(east, west) / sideSum
  }
  return { country, countryConf, countries, side, sideConf }
}

// Top location suggestions for one-tap picking. Same evidence as guessRegion,
// but Ecuador is split by side of the Andes so "Ecuador · East of Andes" can be
// offered directly. Each score is the share of raw prediction mass documented
// there. Suggestions are shown, never applied automatically.
export function suggestLocations(checklist, rawLeaves, n = 3) {
  const total = rawLeaves.reduce((a, [, p]) => a + p, 0) || 1
  const mass = new Map()
  const add = (key, country, side, p) => {
    const cur = mass.get(key) || { country, side, score: 0 }
    cur.score += p
    mass.set(key, cur)
  }
  for (const [name, p] of rawLeaves) {
    const e = entryFor(checklist, name)
    if (!e || !e.countries) continue
    for (const c in e.countries) {
      if (!(e.countries[c] > 0)) continue
      if (c === 'Ecuador' && (e.East > 0 || e.West > 0)) {
        if (e.East > 0) add('Ecuador|East', c, 'East', p)
        if (e.West > 0) add('Ecuador|West', c, 'West', p)
      } else add(c, c, '', p)
    }
  }
  return [...mass.values()]
    .map((m) => ({ ...m, score: m.score / total }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
}

// Sorted list of countries present in the checklist (for the Country dropdown).
let _countriesPromise = null
export function loadCountries() {
  if (_countriesPromise) return _countriesPromise
  _countriesPromise = getChecklist().then((ck) => {
    const set = new Set()
    for (const k in ck) {
      const c = ck[k] && ck[k].countries
      if (c) for (const name in c) set.add(name)
    }
    return Array.from(set).sort()
  })
  return _countriesPromise
}
