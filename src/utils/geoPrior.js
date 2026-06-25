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
