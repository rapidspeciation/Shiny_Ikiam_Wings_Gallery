// Lazy-loads + caches the three curation datasets used by the curation tools.
// Each file is fetched at most once, on FIRST use, and cached module-wide.
//
// Files (in public/data/, keyed as documented):
//   wing_boxes.json    -> { "<CAMID+view>": [ { box:[x1,y1,x2,y2], conf }, ... ] }  (normalized 0..1)
//   predictions.json   -> { "<CAMID>": { subspecies:[[t,c]], species:[[t,c]], genus:[[t,c]], n_views } }
//   taxon_links.json   -> { "<taxon>": { boa, sangay, noreste, cotacachi } }

const BASE = import.meta.env.BASE_URL

// Module-wide caches (one promise per file -> single fetch, deduped).
const fileCache = {
  wing_boxes: null,
  predictions: null,
  taxon_links: null,
  region_checklist: null
}

function loadFile(name) {
  if (fileCache[name]) return fileCache[name]
  const url = `${BASE}data/${name}.json`
  fileCache[name] = fetch(url)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load ${name}.json`)
      return res.json()
    })
    .catch(err => {
      // Reset so a later call can retry; surface a safe empty object.
      fileCache[name] = null
      throw err
    })
  return fileCache[name]
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

// Returns the array of boxes for a photo Name, or [] if none / not loaded yet.
export async function getBoxes(name) {
  const key = boxKeyFromName(name)
  if (!key) return []
  try {
    const data = await loadFile('wing_boxes')
    const boxes = data[key]
    return Array.isArray(boxes) ? boxes : []
  } catch {
    return []
  }
}

// Returns the prediction object for a CAM_ID, or null if none.
export async function getPredictions(camid) {
  if (!camid) return null
  try {
    const data = await loadFile('predictions')
    return data[camid] || null
  } catch {
    return null
  }
}

// Returns the whole predictions map ({ CAM_ID -> pred }), cached. {} on failure.
export async function getAllPredictions() {
  try {
    return await loadFile('predictions')
  } catch {
    return {}
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
export function predictionDiffers(item, pred) {
  if (!item || !pred) return false
  const recSp = cleanTaxon(item.Species)
  const recSsp = cleanTaxon(item.Subspecies_Form)
  const topSp = pred.species && pred.species[0] && pred.species[0][0]
  const topSsp = pred.subspecies && pred.subspecies[0] && pred.subspecies[0][0]

  if (recSp && topSp && topSp.toLowerCase() !== recSp.toLowerCase()) return true

  if (recSsp && topSsp) {
    // recSsp may be the bare epithet or the full trinomial; reduce to the epithet
    const recEpithet = recSsp.includes(' ') ? recSsp.split(/\s+/).pop() : recSsp
    const topParts = topSsp.split(/\s+/)
    const topSpecies = topParts.slice(0, 2).join(' ')   // "Genus species"
    const topEpithet = topParts.slice(2).join(' ')      // remainder (handles "type b")
    const speciesMatches = recSp && topSpecies.toLowerCase() === recSp.toLowerCase()
    if (speciesMatches && topEpithet.toLowerCase() !== recEpithet.toLowerCase()) return true
  }
  return false
}

// Region subspecies of a species, side-filtered. Returns the checklist keys `k`
// where k startsWith "<species> ", k has exactly 3 words, and it is present on
// the given side (or on EITHER side when side is empty/falsy).
export async function regionSubspeciesOf(species, side) {
  if (!species) return []
  const checklist = await getChecklist()
  const prefix = `${species} `
  const out = []
  for (const k in checklist) {
    if (!k.startsWith(prefix)) continue
    if (k.split(/\s+/).length !== 3) continue
    if (onSide(checklist[k], side)) out.push(k)
  }
  return out.sort()
}

// Region species of a genus, side-filtered. Returns the distinct first-2-words
// ("Genus species") of checklist keys `k` where k startsWith "<genus> " and the
// key is present on the given side (or either side when side is empty).
export async function regionSpeciesOf(genus, side) {
  if (!genus) return []
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
  return Array.from(set).sort()
}

// --- internal helpers -----------------------------------------------------

function cleanTaxon(v) {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  return (!s || s === 'NA' || s === 'None') ? '' : s
}

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
    getBoxes, getPredictions, getAllPredictions, getLinks, boxKeyFromName,
    getChecklist, regionSubspeciesOf, regionSpeciesOf, predictionDiffers
  }
}
