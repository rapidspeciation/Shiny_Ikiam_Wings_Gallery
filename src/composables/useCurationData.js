// Lazy-loads + caches the three curation datasets used by the curation tools.
// Each file is fetched at most once, on FIRST use, and cached module-wide.
//
// Files (in public/data/, keyed as documented):
//   wing_boxes.json    -> { "<CAMID+view>": [ { box:[x1,y1,x2,y2], conf }, ... ] }  (normalized 0..1)
//   predictions.json   -> { "<CAMID>": { subspecies:[[t,c]], species:[[t,c]], genus:[[t,c]], n_views } }
//   taxon_links.json   -> { "<taxon>": { boa, sangay, noreste, cotacachi } }

const BASE = import.meta.env.BASE_URL
import { resolveCamid } from '../utils/galleryPipeline.js'
import { canonicalTaxon, predictionDiffers, rankComparison } from '../utils/taxonomy.js'
export { resolveCamid, predictionDiffers, canonicalTaxon, rankComparison }

// Module-wide caches (one promise per file -> single fetch, deduped).
const fileCache = new Map()

export const BOX_SOURCES = {
  v6: { file: 'wing_boxes_v6', label: 'Wings-v6 union boxes' },
  legacy: { file: 'wing_boxes', label: 'Wings-v3 legacy boxes' }
}

export const PREDICTION_SOURCES = {
  candidate_d: { file: 'predictions', label: 'Candidate D · corrected OOF' },
  live_real: { file: 'predictions_live_real', label: 'Live released inference' },
  legacy: { file: 'predictions_legacy', label: 'Legacy gallery model (audit only)' }
}

function loadFile(name) {
  if (fileCache.has(name)) return fileCache.get(name)
  const url = `${BASE}data/${name}.json`
  const promise = fetch(url)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load ${name}.json`)
      return res.json()
    })
    .catch(err => {
      // Reset so a later call can retry; surface a safe empty object.
      fileCache.delete(name)
      throw err
    })
  fileCache.set(name, promise)
  return promise
}

function sourceFile(sources, source, fallback) {
  return (sources[source] || sources[fallback]).file
}

export async function getCurationSourceMeta() {
  try { return await loadFile('curation_sources') } catch { return {} }
}

// --- Key derivation -------------------------------------------------------

// Photo Name -> wing_boxes key: strip the file extension.
//   "CAM072174d.JPG" -> "CAM072174d"
export function boxKeyFromName(name) {
  if (!name || typeof name !== 'string') return null
  const dot = name.lastIndexOf('.')
  return dot === -1 ? name : name.slice(0, dot)
}

export const SOURCE_KEYS = ['boa', 'sangay', 'noreste', 'cotacachi']

export const SOURCE_LABELS = {
  boa: 'BoA',
  sangay: 'Sangay',
  noreste: 'Noreste',
  cotacachi: 'Cotacachi'
}

export const SOURCE_FULL_NAMES = {
  boa: 'Butterflies of America',
  sangay: 'Sangay',
  noreste: 'Noreste',
  cotacachi: 'Cotacachi'
}

// --- Async getters --------------------------------------------------------

// Warm the wing-boxes cache in the background so the first "Zoom to wings" /
// "Wing boxes" toggle doesn't pay for the ~2 MB cold fetch. Safe to call repeatedly
// (loadFile dedupes to a single request). Errors are swallowed; getBoxes retries.
export function preloadBoxes(source = 'v6') {
  return loadFile(sourceFile(BOX_SOURCES, source, 'v6')).catch(() => {})
}

// Returns the array of boxes for a photo Name, or [] if none / not loaded yet.
export async function getBoxes(name, source = 'v6') {
  const key = boxKeyFromName(name)
  if (!key) return []
  try {
    const data = await loadFile(sourceFile(BOX_SOURCES, source, 'v6'))
    const boxes = data[key] || data[key.toUpperCase()] || data[key.toLowerCase()]
    return Array.isArray(boxes) ? boxes : []
  } catch {
    return []
  }
}

export async function getAllBoxes(source = 'v6') {
  try { return await loadFile(sourceFile(BOX_SOURCES, source, 'v6')) } catch { return {} }
}

// Returns the prediction object for a CAM_ID, or null if none.
export async function getPredictions(camid, source = 'candidate_d') {
  if (!camid) return null
  try {
    const data = await loadFile(sourceFile(PREDICTION_SOURCES, source, 'candidate_d'))
    const hit = data[camid] || data[String(camid).toUpperCase()]
    if (hit || source !== 'candidate_d') return hit || null
    const live = await loadFile(PREDICTION_SOURCES.live_real.file)
    return live[camid] || live[String(camid).toUpperCase()] || null
  } catch {
    return null
  }
}

// Returns the whole predictions map ({ CAM_ID -> pred }), cached. {} on failure.
export async function getAllPredictions(source = 'candidate_d') {
  try {
    const data = await loadFile(sourceFile(PREDICTION_SOURCES, source, 'candidate_d'))
    if (source !== 'candidate_d') return data
    const live = await loadFile(PREDICTION_SOURCES.live_real.file).catch(() => ({}))
    return { ...live, ...data }
  } catch {
    return {}
  }
}

export async function getPredictionMissingReason(camid, rank = null) {
  if (!camid) return null
  try {
    const data = await loadFile('prediction_missing_reasons')
    const entry = data[String(camid).toUpperCase()]
    if (!entry) return null
    return rank ? (entry.ranks?.[rank] || entry.reason || null) : (entry.reason || null)
  } catch {
    return null
  }
}

export async function getAllPredictionMissingReasons() {
  try { return await loadFile('prediction_missing_reasons') } catch { return {} }
}

export async function getBoxReason(name) {
  const key = boxKeyFromName(name)
  if (!key) return null
  try {
    const data = await loadFile('wing_box_reasons')
    return data[key.toLowerCase()] || data[key] || null
  } catch {
    return null
  }
}

export async function getAllBoxReasons() {
  try { return await loadFile('wing_box_reasons') } catch { return {} }
}

function stableBoxes(boxes) {
  if (!Array.isArray(boxes)) return '[]'
  return JSON.stringify(boxes.map(b => b?.box))
}

export function topPredictionTaxon(pred) {
  if (!pred) return null
  return pred.subspecies?.[0]?.[0] || pred.species?.[0]?.[0] || pred.genus?.[0]?.[0] || null
}

// Compares the two immutable review sources without changing either file's schema.
// Pass preloaded maps for bulk filtering; omit them for a single card.
export async function compareCurationVersions(item, preloaded = null) {
  const maps = preloaded || {
    newBoxes: await getAllBoxes('v6'), oldBoxes: await getAllBoxes('legacy'),
    newPredictions: await getAllPredictions('candidate_d'), oldPredictions: await getAllPredictions('legacy')
  }
  const names = (item?.all_photos || []).map(p => p?.Name).filter(Boolean)
  if (!names.length) {
    if (item?.Photo_dorsal) names.push(item.Photo_dorsal)
    if (item?.Photo_ventral) names.push(item.Photo_ventral)
  }
  const photos = names.map(name => {
    const key = boxKeyFromName(name)
    const newBoxes = maps.newBoxes[key] || []
    const oldBoxes = maps.oldBoxes[key] || []
    return { name, key, newBoxes, oldBoxes, boxesDiffer: stableBoxes(newBoxes) !== stableBoxes(oldBoxes) }
  })
  const camid = resolveCamid(item)
  const newPrediction = camid ? maps.newPredictions[camid] || null : null
  const oldPrediction = camid ? maps.oldPredictions[camid] || null : null
  const newTaxon = topPredictionTaxon(newPrediction)
  const oldTaxon = topPredictionTaxon(oldPrediction)
  return {
    photos,
    boxesDiffer: photos.some(p => p.boxesDiffer),
    predictionsDiffer: newTaxon !== oldTaxon,
    newPrediction, oldPrediction, newTaxon, oldTaxon,
    hasNewBoxes: photos.some(p => p.newBoxes.length),
    hasNewPrediction: !!newPrediction
  }
}

// Returns the model FORM prediction for a CAM_ID, or null. Shape:
// { species, form, conf, alts:[[form,score],...], recorded }  (out-of-fold).
// Only specimens in separable polymorphic species (e.g. Heliconius doris) have one.
export async function getFormPrediction(camid) {
  if (!camid) return null
  try {
    return (await loadFile('form_predictions'))[camid] || null
  } catch {
    return null
  }
}

// Returns the region checklist map keyed at genus / "Genus species" /
// "Genus species subspecies", cached. {} on failure.
export async function getChecklist() {
  try {
    return await loadFile('region_checklist')
  } catch {
    return {}
  }
}

// True when the prediction's top species/subspecies disagrees with the recorded
// ID. SHARED by the panel's "differs" badge and the gallery filter so they agree.
//   item: a collection row (uses .Species and .Subspecies_Form)
//   pred: a predictions.json entry (or null)
// Region subspecies of a species, side-filtered. Returns the checklist keys `k`
// where k startsWith "<species> ", k has exactly 3 words, and it is present on
// the given side (or on EITHER side when side is empty/falsy).
const _regionCache = new Map()   // memoise enumerations (reused across many cards)

export async function regionSubspeciesOf(species, side) {
  if (!species) return []
  const ck = 'ss|' + species + '|' + (side || '')
  if (_regionCache.has(ck)) return _regionCache.get(ck)
  const checklist = await getChecklist()
  const prefix = `${species} `
  const out = []
  for (const k in checklist) {
    if (!k.startsWith(prefix)) continue
    if (k.split(/\s+/).length !== 3) continue
    if (onSide(checklist[k], side)) out.push(k)
  }
  out.sort()
  _regionCache.set(ck, out)
  return out
}

// Region species of a genus, side-filtered. Returns the distinct first-2-words
// ("Genus species") of checklist keys `k` where k startsWith "<genus> " and the
// key is present on the given side (or either side when side is empty).
export async function regionSpeciesOf(genus, side) {
  if (!genus) return []
  const ck = 'sp|' + genus + '|' + (side || '')
  if (_regionCache.has(ck)) return _regionCache.get(ck)
  const checklist = await getChecklist()
  const prefix = `${genus} `
  const set = new Set()
  for (const k in checklist) {
    if (!k.startsWith(prefix)) continue
    if (!onSide(checklist[k], side)) continue
    const parts = k.split(/\s+/)
    if (parts.length < 2) continue
    set.add(`${parts[0]} ${parts[1]}`)
  }
  const out = Array.from(set).sort()
  _regionCache.set(ck, out)
  return out
}

// --- internal helpers -----------------------------------------------------

function onSide(entry, side) {
  if (!entry) return false
  if (side === 'East') return entry.East > 0
  if (side === 'West') return entry.West > 0
  return entry.East > 0 || entry.West > 0   // unknown side: either side counts
}

const EU = ['sangay', 'noreste', 'cotacachi']

// Returns { boa, sangay, noreste, cotacachi } for a taxon, resolved per the
// prediction LEVEL and how each site is structured (see build_taxon_links.py):
//   subspecies -> BoA species page + each .eu site's EXACT fiche (epithet match) only
//   species    -> BoA species page + each .eu site's genus thumbnails
//   genus      -> BoA genus page  + each .eu site's genus thumbnails
// A source the sites don't have for this taxon stays null -> the UI omits the chip.
export async function getLinks(taxon) {
  const result = { boa: null, sangay: null, noreste: null, cotacachi: null }
  if (!taxon || typeof taxon !== 'string') return result
  const p = taxon.trim().split(/\s+/).filter(Boolean)
  if (!p.length) return result

  let data
  try {
    data = await loadFile('taxon_links')
  } catch {
    return result
  }
  const boa = data.boa || {}, thumb = data.eu_thumb || {}, fiche = data.eu_fiche || {}
  const genus = p[0]

  if (p.length >= 3) {            // subspecies: exact fiche by epithet only
    const ssp = p[2]
    result.boa = boa[`${genus} ${p[1]} ${ssp}`] || boa[`${genus} ${p[1]}`] || null
    for (const s of EU) result[s] = (fiche[s] && fiche[s][`${genus} ${ssp}`]) || null
  } else if (p.length === 2) {    // species: BoA species page + .eu genus thumbnails
    result.boa = boa[`${genus} ${p[1]}`] || null
    for (const s of EU) result[s] = (thumb[s] && thumb[s][genus]) || null
  } else {                        // genus: BoA genus page + .eu genus thumbnails
    result.boa = boa[genus] || null
    for (const s of EU) result[s] = (thumb[s] && thumb[s][genus]) || null
  }
  return result
}

export function useCurationData() {
  return {
    getBoxes, getAllBoxes, preloadBoxes, getPredictions, getAllPredictions, getLinks, boxKeyFromName,
    getCurationSourceMeta, compareCurationVersions, topPredictionTaxon,
    getPredictionMissingReason, getAllPredictionMissingReasons, getBoxReason, getAllBoxReasons,
    resolveCamid,
    getChecklist, regionSubspeciesOf, regionSpeciesOf, predictionDiffers
  }
}
