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

// --- Google-scoped fallback links ----------------------------------------

const SOURCE_DOMAINS = {
  boa: 'butterfliesofamerica.com',
  sangay: 'sangay.eu',
  noreste: 'noreste.eu',
  cotacachi: 'cotacachi.eu'
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

function googleFallback(source, taxon) {
  const domain = SOURCE_DOMAINS[source]
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ${taxon}`)}`
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

// Returns { boa, sangay, noreste, cotacachi } for a taxon, with:
//   trinomial -> binomial fallback for the lookup, then a Google-scoped
//   fallback URL for any source missing from the matched entry.
// `taxon` should be the most specific name available ("Genus species subspecies"
// or "Genus species"). Always returns a full set of 4 URLs (never null).
export async function getLinks(taxon) {
  const result = { boa: null, sangay: null, noreste: null, cotacachi: null }
  if (!taxon || typeof taxon !== 'string') return result

  const trimmed = taxon.trim()
  if (!trimmed) return result

  let entry = null
  try {
    const data = await loadFile('taxon_links')
    // Try the full taxon first (could be trinomial), then binomial fallback.
    entry = data[trimmed] || null
    if (!entry) {
      const parts = trimmed.split(/\s+/)
      if (parts.length >= 2) {
        const binomial = `${parts[0]} ${parts[1]}`
        entry = data[binomial] || null
      }
    }
  } catch {
    entry = null
  }

  for (const src of SOURCE_KEYS) {
    const url = entry && entry[src]
    result[src] = url || googleFallback(src, trimmed)
  }
  return result
}

export function useCurationData() {
  return { getBoxes, getPredictions, getLinks, boxKeyFromName }
}
