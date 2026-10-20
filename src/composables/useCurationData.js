// Lazy-loads + caches the three curation datasets used by the curation tools.
// Each file is fetched at most once, on FIRST use, and cached module-wide.
//
// Files (in public/data/, keyed as documented):
//   wing_boxes.json    -> { "<CAMID+view>": [ { box:[x1,y1,x2,y2], conf }, ... ] }  (normalized 0..1)
//   wing_boxes_app.json -> same shape, one tight union box per photo from the Database Manager's readings
//                          (+ file: Drive ID of the photo read); preferred over wing_boxes_v6.json
//   wing_outlines.json -> { photos: { "<CAMID+view>": { file, w: [[kind, half, SVG path data: "m x y l dx dy ... z" (v2) or "M x y ... Z" (v1)], ...] } } }
//                          (0..1000 grid; fetched only when "Wing outlines" is first turned on)
//   predictions.json   -> { "<CAMID>": { subspecies:[[t,c]], species:[[t,c]], genus:[[t,c]], n_views } }
//   predictions_oof.json -> the out-of-fold rows of predictions.json, slimmed (scripts/build-oof-predictions.mjs);
//                          shown before any final-fit prediction (utils/predictionCoverage.js)
//   taxon_links.json   -> { "<taxon>": { boa, sangay, noreste, cotacachi } }

const BASE = import.meta.env.BASE_URL
import { resolveCamid } from '../utils/galleryPipeline.js'
import { canonicalTaxon, predictionDiffers, rankComparison } from '../utils/taxonomy.js'
import { loadCurrentPredictionMaps } from '../utils/predictionCoverage.js'
import { regionSpecies, regionSubspecies } from '../utils/taxonTree.js'
import { loadTaxonNames, lookupOrder, canonical } from '../utils/taxonNames.js'
import { mergeGbifPresence } from '../utils/geoPrior.js'
import { driveFileId, pickBoxes, photoOutlines } from '../utils/wingBoxes.js'
export { resolveCamid, predictionDiffers, canonicalTaxon, rankComparison }

// Module-wide caches (one promise per file -> single fetch, deduped).
const fileCache = new Map()
let currentPredictionsPromise = null

export const BOX_SOURCES = {
  // The app's tight boxes where a photo has one, else wing_boxes_v6 (see getBoxes).
  current: { file: 'wing_boxes_app', fallback: 'v6', label: 'Current wing boxes (Database Manager readings, else the segmentation boxes)' },
  v6: { file: 'wing_boxes_v6', label: 'Current butterfly segmentation boxes' },
  legacy: { file: 'wing_boxes', label: 'Previous butterfly segmentation boxes' }
}

export const PREDICTION_SOURCES = {
  candidate_d: { file: 'predictions_expanded_concat_dv', label: 'Current taxonomic classifier · paired dorsal/ventral' },
  current_coverage: { file: 'predictions_coverage_current', label: 'Current classifier coverage' },
  live_real: { file: 'predictions_live_real', label: 'Live released inference' },
  legacy: { file: 'predictions_legacy', label: 'Previous gallery classifier (audit only)' }
}

function loadFile(name) {
  if (fileCache.has(name)) return fileCache.get(name)
  const url = `${BASE}data/${name}.json`
  const promise = fetch(url)
    .then(res => {
      if (!res.ok) {
        const error = new Error(`Failed to load ${name}.json`)
        error.status = res.status
        throw error
      }
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

// Files published by the Database Manager (downloaded by update_data.yml). They
// are absent until its first readings; a missing or broken copy reads as {}.
const optionalCache = new Map()
function loadOptionalFile(name) {
  if (!optionalCache.has(name)) optionalCache.set(name, loadFile(name).catch(() => ({})))
  return optionalCache.get(name)
}

// Box map for a source; a source with a fallback is a layer over it, by photo.
async function loadBoxMap(source) {
  const src = BOX_SOURCES[source] || BOX_SOURCES.current
  if (!src.fallback) return loadFile(src.file)
  const [layer, fallback] = await Promise.all([loadOptionalFile(src.file), loadFile(BOX_SOURCES[src.fallback].file).catch(() => ({}))])
  return { layer, fallback }
}

export { driveFileId }

function loadCurrentPredictions() {
  if (currentPredictionsPromise) return currentPredictionsPromise
  currentPredictionsPromise = loadCurrentPredictionMaps(loadFile).catch(error => {
    currentPredictionsPromise = null
    throw error
  })
  return currentPredictionsPromise
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
  const stem = dot === -1 ? name : name.slice(0, dot)
  // Drive disambiguates duplicate filenames as `CAM...v (2)`; keep the
  // canonical artifact key whitespace-free while preserving the occurrence.
  return stem.replace(/\s+\((\d+)\)$/, '_$1')
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
export function preloadBoxes(source = 'current') {
  return loadBoxMap(source).catch(() => {})
}

// Returns the array of boxes for a photo Name, or [] if none / not loaded yet.
// The default source takes the app's tight box when it read this very file
// (fileId: the photo's Drive ID, when known), else the wing_boxes_v6 box.
export async function getBoxes(name, source = 'current', fileId = null) {
  const key = boxKeyFromName(name)
  if (!key) return []
  try {
    const data = await loadBoxMap(source)
    return data.layer ? pickBoxes(data.layer, data.fallback, key, fileId) : pickBoxes(null, data, key)
  } catch {
    return []
  }
}

// Wing outlines, loaded once on first use (the file is several MB). Resolves to
// the `photos` map, frozen and never made reactive; {} when not published yet.
let outlinesPromise = null
export function loadOutlines() {
  if (!outlinesPromise) {
    outlinesPromise = loadFile('wing_outlines')
      .then(data => Object.freeze(data && typeof data.photos === 'object' && data.photos ? data.photos : {}))
      .catch(error => { outlinesPromise = null; throw error })
  }
  return outlinesPromise
}

// Drawable outlines of one photo (by Name) from the loaded map: [{ kind, half, d }].
export function outlinesFor(photos, name, fileId = null) {
  return photoOutlines(photos, boxKeyFromName(name), fileId)
}

export async function getAllBoxes(source = 'v6') {
  try { return await loadFile(sourceFile(BOX_SOURCES, source, 'v6')) } catch { return {} }
}

// Returns the prediction object for a CAM_ID, or null if none.
export async function getPredictions(camid, source = 'candidate_d') {
  if (!camid) return null
  const data = source === 'candidate_d'
    ? await loadCurrentPredictions()
    : await loadFile(sourceFile(PREDICTION_SOURCES, source, 'candidate_d'))
  return data[camid] || data[String(camid).toUpperCase()] || null
}

// Returns the whole predictions map ({ CAM_ID -> pred }), cached. The current
// coverage file is optional during rollout; other load failures remain visible.
export async function getAllPredictions(source = 'candidate_d') {
  if (source === 'candidate_d') return loadCurrentPredictions()
  return loadFile(sourceFile(PREDICTION_SOURCES, source, 'candidate_d'))
}

// Out-of-fold sex predictions keyed by CAM_ID. These are collection-only;
// AI Identifier uploads do not use this asset.
// The Database Manager's readings (sex_predictions_app.json) fill specimens the
// release has not scored.
let sexPredictionsPromise = null
export async function getAllSexPredictions() {
  if (!sexPredictionsPromise) {
    sexPredictionsPromise = Promise.all([loadFile('sex_predictions'), loadOptionalFile('sex_predictions_app')])
      .then(([release, app]) => ({ ...app, ...release }))
      .catch(error => { sexPredictionsPromise = null; throw error })
  }
  return sexPredictionsPromise
}

export async function getSexPrediction(camid) {
  if (!camid) return null
  const data = await getAllSexPredictions()
  return data[camid] || data[String(camid).toUpperCase()] || null
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
let _checklistPromise = null
export async function getChecklist() {
  if (!_checklistPromise) {
    _checklistPromise = (async () => {
      let ck = {}
      try { ck = await loadFile('region_checklist') } catch { return {} }
      try {
        const [presence] = await Promise.all([loadFile('gbif_country_presence'), loadTaxonNames()])
        return mergeGbifPresence(ck, presence, canonical)
      } catch {
        return ck // GBIF presence is an enhancement; the checklist alone still works
      }
    })()
  }
  return _checklistPromise
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
  const out = regionSubspecies(await getChecklist(), species, side)
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
  const out = regionSpecies(await getChecklist(), genus, side)
  _regionCache.set(ck, out)
  return out
}

const EU = ['sangay', 'noreste', 'cotacachi']

// Returns { boa, sangay, noreste, cotacachi } for a taxon, resolved per the
// prediction LEVEL and how each site is structured (see build_taxon_links.py):
//   subspecies -> BoA species page + each .eu site's EXACT fiche (epithet match) only
//   species    -> BoA species page + each .eu site's genus thumbnails
//   genus      -> BoA genus page  + each .eu site's genus thumbnails
// A source the sites don't have for this taxon stays null -> the UI omits the chip.
// The link tables use the old names, so each source takes the first hit among the
// requested name, its canonical name and its aliases (taxonNames.js).
export async function getLinks(taxon) {
  const result = { boa: null, sangay: null, noreste: null, cotacachi: null }
  if (!taxon || typeof taxon !== 'string') return result
  if (!taxon.trim()) return result

  let data
  try {
    [data] = await Promise.all([loadFile('taxon_links'), loadTaxonNames()])
  } catch {
    return result
  }
  // exact pages under every name first, then the species page for a subspecies
  for (const speciesFallback of [false, true]) {
    for (const name of lookupOrder(taxon)) {
      const hit = linksFor(data, name, { speciesFallback })
      for (const k of Object.keys(result)) if (!result[k] && hit[k]) result[k] = hit[k]
    }
  }
  return result
}

export function linksFor(data, taxon, { speciesFallback = true } = {}) {
  const result = { boa: null, sangay: null, noreste: null, cotacachi: null }
  const p = taxon.trim().split(/\s+/).filter(Boolean)
  if (!p.length) return result
  const boa = data.boa || {}, thumb = data.eu_thumb || {}, fiche = data.eu_fiche || {}
  const genus = p[0]

  if (p.length >= 3) {            // subspecies: exact fiche by epithet only
    const ssp = p[2]
    result.boa = boa[`${genus} ${p[1]} ${ssp}`] || (speciesFallback && boa[`${genus} ${p[1]}`]) || null
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
    getBoxes, getAllBoxes, preloadBoxes, loadOutlines, outlinesFor, driveFileId, getPredictions, getAllPredictions,
    getSexPrediction, getAllSexPredictions, getLinks, boxKeyFromName,
    getCurationSourceMeta, compareCurationVersions, topPredictionTaxon,
    getPredictionMissingReason, getAllPredictionMissingReasons, getBoxReason, getAllBoxReasons,
    resolveCamid,
    getChecklist, regionSubspeciesOf, regionSpeciesOf, predictionDiffers
  }
}
