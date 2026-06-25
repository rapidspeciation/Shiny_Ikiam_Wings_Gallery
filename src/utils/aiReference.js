// Reference images for a predicted taxon.
//   1. Sanger collection wing photos (the group's own museum specimens, highest
//      quality) — built from collection.json (URLd/URLv Google-Drive photos).
//   2. GBIF fallback, MUSEUM-first (PRESERVED_SPECIMEN), then any record.
// Subspecies -> species fallback at each level. We never ship scraped images.
import { getProxiedUrl } from './imageProxy.js'

const BASE = import.meta.env.BASE_URL

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
        const photos = []
        if (clean(r.URLd)) photos.push({ url: r.URLd, view: 'dorsal' })
        if (clean(r.URLv)) photos.push({ url: r.URLv, view: 'ventral' })
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
  const isSub = taxon.split(/\s+/).length >= 3
  const specimens = (isSub && byTrinomial.get(taxon)) || byBinomial.get(binomialOf(taxon)) || []
  const level = isSub && byTrinomial.get(taxon) ? 'subspecies' : 'species'
  const photos = []
  for (const sp of specimens) {
    for (const ph of sp.photos) {
      photos.push({
        url: getProxiedUrl(ph.url, { width: 800 }),
        thumb: getProxiedUrl(ph.url, { width: 400 }),
        caption: `${sp.camid} · ${ph.view}`,
        credit: 'Sanger / Ikiam collection',
        source: 'sanger',
      })
      if (photos.length >= max) return { photos, level }
    }
  }
  return { photos, level }
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
        url: m.identifier,
        thumb: m.identifier,
        caption: occ.basisOfRecord === 'PRESERVED_SPECIMEN' ? 'museum specimen' : 'observation',
        credit: `${m.rightsHolder || occ.recordedBy || 'GBIF'} · ${m.license ? licenseShort(m.license) : 'see GBIF'}`,
        link: occ.key ? `https://www.gbif.org/occurrence/${occ.key}` : 'https://www.gbif.org',
        source: 'gbif',
      })
      if (out.length >= max) return out
    }
  }
  return out
}

function licenseShort(l) {
  const m = String(l).match(/(CC[\s_-]?(?:BY|0)[\w-]*)/i)
  return m ? m[1].replace(/_/g, '-') : 'CC'
}

async function gbifPhotos(taxon, max = 6) {
  for (const name of dedupe([taxon, binomialOf(taxon)])) {
    const key = await gbifKey(name)
    if (!key) continue
    // museum first, then top up with any record
    let photos = await gbifOccurrenceMedia(key, true, max)
    if (photos.length < max) {
      const more = await gbifOccurrenceMedia(key, false, max - photos.length)
      photos = photos.concat(more.filter((p) => !photos.some((q) => q.url === p.url)))
    }
    if (photos.length) return { photos, level: name === taxon ? 'subspecies' : 'species' }
  }
  return { photos: [], level: 'none' }
}

const dedupe = (a) => [...new Set(a)]

// Public: Sanger first; GBIF only if Sanger has nothing.
export async function referencesFor(taxon) {
  if (!taxon) return { photos: [], source: 'none', level: 'none' }
  const sanger = await sangerPhotos(taxon)
  if (sanger.photos.length) return { ...sanger, source: 'sanger' }
  const gbif = await gbifPhotos(taxon)
  return { ...gbif, source: gbif.photos.length ? 'gbif' : 'none' }
}
