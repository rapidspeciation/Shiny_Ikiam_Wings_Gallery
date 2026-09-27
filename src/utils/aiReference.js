// Reference images for a predicted taxon.
//   1. Sanger collection wing photos (the group's own museum specimens, highest
//      quality) — built from collection.json (URLd/URLv Google-Drive photos).
//   2. GBIF fallback, MUSEUM-first (PRESERVED_SPECIMEN), then any record.
// Subspecies -> species fallback at each level. We never ship scraped images.
// Collection records keep the recorded (old) names, so every level also tries
// the canonical name and its aliases (taxonNames.js): specimens recorded under
// any name of a merged taxon are shown together, the requested name first.
import { webImageUrl, getProxiedUrl } from './imageProxy.js'
import { loadTaxonNames, lookupOrder } from './taxonNames.js'

const BASE = import.meta.env?.BASE_URL ?? '/'

const clean = (v) => {
  if (v == null) return ''
  const s = String(v).trim()
  return (!s || s === 'NA' || s === 'None') ? '' : s
}
const binomialOf = (t) => t.split(/\s+/).slice(0, 2).join(' ')

// --- Sanger index (taxon -> photos), built once from collection.json ---
let _sangerPromise = null
function buildSangerIndex() {
  if (_sangerPromise) return _sangerPromise
  _sangerPromise = fetch(`${BASE}data/collection.json`)
    .then((r) => r.json())
    .then((rows) => {
      const byBinomial = new Map(), byTrinomial = new Map()
      for (const r of rows) {
        const sp = clean(r.Species)
        if (!sp) continue
        // Ventral first: that's the wing surface visible when the wings are closed,
        // i.e. what a field photo of a perched/collected butterfly usually shows.
        const photos = []
        if (clean(r.URLv)) photos.push({ url: r.URLv, view: 'ventral' })
        if (clean(r.URLd)) photos.push({ url: r.URLd, view: 'dorsal' })
        if (!photos.length) continue
        const entry = { camid: clean(r.CAM_ID), photos }
        const push = (map, key) => { if (!map.has(key)) map.set(key, []); map.get(key).push(entry) }
        push(byBinomial, sp)
        const ssp = clean(r.Subspecies_Form)
        if (ssp) {
          const tri = ssp.toLowerCase().startsWith(sp.toLowerCase()) ? ssp : `${sp} ${ssp.split(/\s+/).pop()}`
          push(byTrinomial, tri)
        }
      }
      return { byBinomial, byTrinomial }
    })
    .catch(() => ({ byBinomial: new Map(), byTrinomial: new Map() }))
  return _sangerPromise
}

async function sangerPhotos(taxon, max = 6) {
  const { byBinomial, byTrinomial } = await buildSangerIndex()
  const collect = (map, name) => {
    const names = [], specimens = []
    for (const n of lookupOrder(name)) {
      const hit = map.get(n)
      if (hit?.length) { names.push(n); specimens.push(...hit) }
    }
    return { names, specimens }
  }
  const isSub = taxon.split(/\s+/).length >= 3
  const sub = isSub ? collect(byTrinomial, taxon) : { names: [], specimens: [] }
  const hit = sub.specimens.length ? sub : collect(byBinomial, binomialOf(taxon))
  const { specimens } = hit
  const level = sub.specimens.length ? 'subspecies' : 'species'
  const recordedAs = hit.names.filter((n) => n !== taxon && n !== binomialOf(taxon))
  const photos = []
  for (const sp of specimens) {
    for (const ph of sp.photos) {
      photos.push({
        url: getProxiedUrl(ph.url, { width: 800 }),
        thumb: getProxiedUrl(ph.url, { width: 400 }),
        caption: `${sp.camid} · ${ph.view}`,
        credit: 'Sanger / Ikiam collection',
        source: 'sanger',
        // wing_boxes.json key (CAMID + d/v) so the gallery can "zoom to wings" on
        // these reference photos too — GBIF photos have no boxes (boxKey stays null).
        boxKey: sp.camid ? `${sp.camid}${ph.view === 'dorsal' ? 'd' : 'v'}` : null,
      })
      if (photos.length >= max) return { photos, level, recordedAs }
    }
  }
  return { photos, level, recordedAs }
}

// --- GBIF fallback, museum-first ---
async function gbifKey(name) {
  try {
    const r = await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`)
    const d = await r.json()
    return d.usageKey || null
  } catch { return null }
}

async function gbifOccurrenceMedia(key, museumOnly, max) {
  const basis = museumOnly ? '&basis_of_record=PRESERVED_SPECIMEN' : ''
  const url = `https://api.gbif.org/v1/occurrence/search?taxon_key=${key}&media_type=StillImage${basis}&limit=20`
  const r = await fetch(url)
  if (!r.ok) return []
  const d = await r.json()
  const out = []
  for (const occ of d.results || []) {
    for (const m of occ.media || []) {
      if (m.type && m.type !== 'StillImage') continue
      if (!m.identifier) continue
      out.push({
        url: webImageUrl(m.identifier, 900),
        thumb: webImageUrl(m.identifier, 300),
        caption: occ.basisOfRecord === 'PRESERVED_SPECIMEN' ? 'museum specimen' : 'observation',
        credit: m.rightsHolder || occ.recordedBy || 'GBIF',
        link: occ.key ? `https://www.gbif.org/occurrence/${occ.key}` : 'https://www.gbif.org',
        source: 'gbif',
      })
      if (out.length >= max) return out
    }
  }
  return out
}

async function gbifPhotos(taxon, max = 6) {
  const names = dedupe([...lookupOrder(taxon), ...lookupOrder(binomialOf(taxon))])
  for (const name of names) {
    const key = await gbifKey(name)
    if (!key) continue
    // museum first, then top up with any record
    let photos = await gbifOccurrenceMedia(key, true, max)
    if (photos.length < max) {
      const more = await gbifOccurrenceMedia(key, false, max - photos.length)
      photos = photos.concat(more.filter((p) => !photos.some((q) => q.url === p.url)))
    }
    if (photos.length) {
      const level = name.split(/\s+/).length >= 3 ? 'subspecies' : 'species'
      const recordedAs = name !== taxon && name !== binomialOf(taxon) ? [name] : []
      return { photos, level, recordedAs }
    }
  }
  return { photos: [], level: 'none', recordedAs: [] }
}

const dedupe = (a) => [...new Set(a)]

// Per-taxon cache so re-rendering / re-expanding a group never re-hits GBIF.
// Keyed by `${taxon}|${max}` — a bigger request is a superset, so we cache the
// largest fetched and slice down for smaller asks.
const _refCache = new Map()

// Public: Sanger first; GBIF only if Sanger has nothing. `max` caps how many
// photos we fetch per taxon (anti-hammer: collapsed gallery groups request 1,
// expanded groups request the full cap).
export async function referencesFor(taxon, max = 6) {
  if (!taxon) return { photos: [], source: 'none', level: 'none' }
  // Serve from a same-or-larger cached fetch.
  for (const [key, promise] of _refCache) {
    const [t, m] = key.split('|')
    if (t === taxon && Number(m) >= max) {
      const r = await promise
      return { ...r, photos: r.photos.slice(0, max) }
    }
  }
  const key = `${taxon}|${max}`
  const job = (async () => {
    await loadTaxonNames()
    const sanger = await sangerPhotos(taxon, max)
    if (sanger.photos.length) return { ...sanger, source: 'sanger' }
    const gbif = await gbifPhotos(taxon, max)
    return { ...gbif, source: gbif.photos.length ? 'gbif' : 'none' }
  })()
  _refCache.set(key, job)
  return job
}
