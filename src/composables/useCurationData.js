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

// Returns { boa, sangay, noreste, cotacachi } for a taxon. Per source we take the
// most specific real page available: subspecies (trinomial) -> species (binomial)
// -> genus page. A source the reference sites don't have for this taxon stays
// null (no dead link / no useless search) — the UI just omits that chip.
export async function getLinks(taxon) {
  const result = { boa: null, sangay: null, noreste: null, cotacachi: null }
  if (!taxon || typeof taxon !== 'string') return result
  const parts = taxon.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return result

  let data
  try {
    data = await loadFile('taxon_links')
  } catch {
    return result
  }

  // most-specific-first lookup keys: trinomial, binomial, genus
  const keys = []
  if (parts.length >= 3) keys.push(parts.slice(0, 3).join(' '))
  if (parts.length >= 2) keys.push(parts.slice(0, 2).join(' '))
  keys.push(parts[0])
  const entries = keys.map(k => data[k]).filter(Boolean)

  for (const src of SOURCE_KEYS) {
    for (const entry of entries) {
      if (entry[src]) { result[src] = entry[src]; break }
    }
  }
  return result
}

export function useCurationData() {
  return { getBoxes, getPredictions, getLinks, boxKeyFromName }
}
