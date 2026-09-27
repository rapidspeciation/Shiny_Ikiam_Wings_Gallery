// Country helpers for the AI Identifier location prior. The prior itself is the
// spatial GBIF prior in geoSpatial.js. The checklist rule below (taxa not recorded
// in the chosen country x eps, checklist merged with GBIF country presence) is
// only the fallback when the spatial files cannot load; mergeGbifPresence also
// feeds the Collection tab's checklist (useCurationData.js). On the field photos
// the checklist rule at x0.3 gave 86.7% species Top-1, the spatial country prior
// 88.6% (reports/geo_spatial_prior_20260927). Never up-weights.
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

// Top countries for one-tap picking, from the photo's own predictions: each
// country scores the summed probability of the photo's top species recorded
// there in the country presence table (gallery checklist or any GBIF record,
// ISO2 codes, current names; true country in the top 3 for 89.9% of the field
// photos). presence = { "Genus species": ["EC", ...] }. Returns
// [{ kind: 'country', iso, score }]; suggestions are shown, never applied.
export function speciesProbs(rawLeaves) {
  const m = new Map()
  for (const [name, p] of rawLeaves || []) {
    const sp = String(name).trim().split(/\s+/).slice(0, 2).join(' ')
    m.set(sp, (m.get(sp) || 0) + p)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export function suggestLocations(presence, rawLeaves, n = 3, top = 200) {
  if (!presence) return []
  const sp = speciesProbs(rawLeaves)
  const total = sp.reduce((a, [, p]) => a + p, 0) || 1
  const mass = new Map()
  for (const [name, p] of sp.slice(0, top)) {
    for (const c of presence[name] || []) mass.set(c, (mass.get(c) || 0) + p)
  }
  return [...mass.entries()]
    .map(([iso, m]) => ({ kind: 'country', iso, score: m / total }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
}

// ISO2 -> English country name (Intl), e.g. 'EC' -> 'Ecuador'.
let _names = null
export function countryName(iso) {
  if (!iso) return ''
  try {
    _names = _names || new Intl.DisplayNames(['en'], { type: 'region' })
    return _names.of(iso) || iso
  } catch { return iso }
}

// Gallery checklist country names that differ from the English names, used only
// by the fallback checklist rule when the spatial prior cannot load.
const CHECKLIST_NAME = { GF: 'French-Guiana', SR: 'Surinam', US: 'USA', SZ: 'Swaziland' }
export const checklistCountry = (iso) => CHECKLIST_NAME[iso] || countryName(iso)

// Countries in the presence table, [{ iso, name }] sorted by name (Country dropdown).
export function countryList(presence) {
  const set = new Set()
  for (const cs of Object.values(presence || {})) for (const c of cs) set.add(c)
  return [...set].map((iso) => ({ iso, name: countryName(iso) })).sort((a, b) => a.name.localeCompare(b.name))
}
