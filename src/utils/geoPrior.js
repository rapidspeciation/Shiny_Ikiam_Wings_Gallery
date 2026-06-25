// Client-side geographic prior for the AI ID tab. Re-ranks the model's raw
// per-leaf probabilities using region_checklist.json (already shipped for the
// gallery), exactly mirroring predict_topk.py's leaf_weights/taxon_weight:
// down-weight (x eps) taxa not documented in the chosen country, and — for
// Ecuador — taxa not documented on the chosen side of the Andes. Never up-weights.
import { getChecklist } from '../composables/useCurationData.js'

export const DEFAULT_EPS = 0.02

// Look up a taxon's checklist entry, falling back trinomial -> binomial.
export function entryFor(checklist, taxon) {
  if (!taxon) return null
  let e = checklist[taxon]
  if (e) return e
  const p = taxon.split(/\s+/)
  if (p.length >= 2) e = checklist[`${p[0]} ${p[1]}`]
  return e || null
}

// weight in (eps, 1]. country '' / 'Any' = no country filter; side '' = no side filter.
export function geoWeight(entry, country, side, eps = DEFAULT_EPS) {
  if (!entry) return 1 // unknown to the checklist -> never penalise
  if (country && country !== 'Any') {
    const inCountry = entry.countries && entry.countries[country] > 0
    if (!inCountry) return eps
  }
  if (side === 'East' || side === 'West') {
    if (!(entry[side] > 0)) return eps
  }
  return 1
}

// Whether a taxon is "off-region" for the chosen prior (drives the off-region tag).
export function isOffRegion(checklist, taxon, country, side, eps = DEFAULT_EPS) {
  return geoWeight(entryFor(checklist, taxon), country, side, eps) < 1
}

// Guess the most likely region from the model's RAW (un-weighted) leaf
// probabilities, by asking the checklist where those taxa actually occur:
//   score(region) = Σ_leaf  P(leaf) · 1[leaf documented in region]
// Returns { country, countryConf, side, sideConf } — '' when undecidable. Used
// for the "I don't know — guess from photo" option. Side is only inferred among
// leaves present in the guessed country (defaults to Ecuador), since the East/
// West split is an Ecuador concept here.
export function guessRegion(checklist, rawLeaves) {
  const total = rawLeaves.reduce((a, [, p]) => a + p, 0) || 1
  const countryMass = new Map()
  for (const [name, p] of rawLeaves) {
    const e = entryFor(checklist, name)
    if (!e || !e.countries) continue
    for (const c in e.countries) {
      if (e.countries[c] > 0) countryMass.set(c, (countryMass.get(c) || 0) + p)
    }
  }
  let country = '', countryConf = 0
  for (const [c, m] of countryMass) if (m > countryConf) { country = c; countryConf = m }
  countryConf = countryConf / total

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
  return { country, countryConf, side, sideConf }
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
