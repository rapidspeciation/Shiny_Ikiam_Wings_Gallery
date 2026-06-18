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
  taxon_links: null
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
  return { getBoxes, getPredictions, getLinks, boxKeyFromName }
}
