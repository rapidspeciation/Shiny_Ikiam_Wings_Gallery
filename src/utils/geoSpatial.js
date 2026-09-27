// Spatial geographic prior for the AI Identifier, built from GBIF occurrence
// records (download 10.15468/dl.wvjxdd, records dated before 12 February 2026).
// Adapted from the reference reader in
// WingsClassificator/reports/geo_spatial_prior_20260927/export/geo_prior.js.
//
// For each species s and location L the prior counts k_s(L), the records of s
// near L (coordinates: Gaussian kernel over 0.5 degree cells, h = 100 km, cut at
// 3h; country: records with that GBIF country code; Ecuador region: records in
// Costa / Sierra / Oriente / Galapagos). Plausibility g = 1 - exp(-k / b), and a
// leaf's probability is multiplied by (1 - lam) + lam * g of its species, then
// renormalised. Tuned settings live in meta.json.gz (coordinates b 10, lam 0.95;
// country b 30, lam 0.98; Ecuador region b 30, lam 0.99). Species without any
// GBIF record, or unknown to the export, are neutral (weight 1).
//
// Files (public/data/geo_prior/): meta.json.gz (100 KB, settings, species,
// country and Ecuador region counts) loads on the first location or Ecuador
// suggestion; tiles/world.bin.gz (526 KB, cell counts) loads only for
// coordinates. country_presence.json (species -> ISO2 countries) drives the
// country suggestions and the country list.

const MAGIC = 0x31544757

// Species with g below this have almost no records near the location; they get
// the "not recorded near here" / "off-region" tag. g < 0.1 means fewer than about
// 1 kernel-weighted record (coordinates) or 3 records (country, region).
export const LOW_G = 0.1

export const EC_REGIONS = ['Costa', 'Sierra', 'Oriente', 'Galapagos']
export const EC_REGION_HINT = {
  Costa: 'Pacific lowlands',
  Sierra: 'Andes, 1,500 m and above',
  Oriente: 'Amazon',
  Galapagos: 'Islands',
}

// Some servers (the Vite dev server, hosts that add Content-Encoding: gzip) let the
// browser decompress .gz files already, so only gunzip when the gzip magic is there.
async function gunzipToArrayBuffer(resp) {
  if (!resp || (resp.ok === false)) throw new Error(`fetch failed (${resp?.status})`)
  const buf = await resp.arrayBuffer()
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength))
  if (!(b[0] === 0x1f && b[1] === 0x8b)) return buf
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream not available')
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(ds).arrayBuffer()
}

export function parseTile(buf) {
  const h = new DataView(buf)
  if (h.getUint32(0, true) !== MAGIC) throw new Error('bad tile magic')
  const nCells = h.getUint32(4, true), nPairs = h.getUint32(8, true), res = h.getFloat32(12, true)
  let o = 16
  const cellId = new Uint32Array(buf, o, nCells); o += 4 * nCells
  const offset = new Uint32Array(buf, o, nCells + 1); o += 4 * (nCells + 1)
  const species = new Uint16Array(buf, o, nPairs); o += 2 * nPairs
  const count = new Uint16Array(buf, o, nPairs)
  return { nCells, nPairs, res, cellId, offset, species, count }
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, a1 = lat1 * r, a2 = lat2 * r
  const s = Math.sin((a2 - a1) / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, s)))
}

// k: local counts per species, E: their sum. Species with no records at all are neutral (g = 1).
export function plausibility(k, E, nRecords, totalRecords, cfg) {
  const S = k.length, g = new Float32Array(S)
  for (let s = 0; s < S; s++) {
    const n = nRecords[s]
    if (n === 0) { g[s] = 1; continue }
    if (cfg.variant === 'ratio') {
      const ps = n / totalRecords
      const rho = (k[s] + cfg.a * ps) / ((E + cfg.a) * ps)
      g[s] = Math.min(1, rho / cfg.b)
    } else {
      g[s] = 1 - Math.exp(-k[s] / cfg.b)
    }
  }
  return g
}

// Kept for parity with the reference reader (golden tests); the site never asks for elevation.
export function elevationFactor(z, lo, hi, sigma) {
  const S = lo.length, e = new Float32Array(S).fill(1)
  if (z === null || z === undefined || Number.isNaN(z)) return e
  for (let s = 0; s < S; s++) {
    if (lo[s] === null) continue
    const d = Math.max(lo[s] - z, 0) + Math.max(z - hi[s], 0)
    e[s] = Math.exp(-0.5 * (d / sigma) ** 2)
  }
  return e
}

export class GeoPrior {
  constructor(baseUrl, fetchImpl) {
    this.base = baseUrl.replace(/\/$/, '')
    this.fetch = fetchImpl || ((u) => fetch(u))
    this.tiles = new Map()
  }

  async load() {
    const r = await this.fetch(`${this.base}/meta.json.gz`)
    this.meta = JSON.parse(new TextDecoder().decode(await gunzipToArrayBuffer(r)))
    this.S = this.meta.species.length
    this.total = this.meta.n_records.reduce((a, b) => a + b, 0)
    this.tileSet = new Set(this.meta.tiles)
    this.index = new Map(this.meta.species.map((n, i) => [n, i]))
    return this
  }

  async tile(name) {
    if (!this.tileSet.has(name)) return null
    if (!this.tiles.has(name)) {
      const p = (async () => parseTile(await gunzipToArrayBuffer(await this.fetch(`${this.base}/tiles/${name}.bin.gz`))))()
      p.catch(() => this.tiles.delete(name))   // allow a retry after a failed download
      this.tiles.set(name, p)
    }
    return this.tiles.get(name)
  }

  // kernel-smoothed record counts of every species around (lat, lon), Gaussian bandwidth hKm, cut at 3 hKm
  async localCounts(lat, lon, hKm) {
    const { res, tile_deg: T } = this.meta
    const ncol = Math.round(360 / res), R = 3 * hKm
    const dLat = R / 111 + res, cosl = Math.max(0.05, Math.cos((lat * Math.PI) / 180))
    const dLon = Math.min(180, R / (111 * cosl) + res)
    const names = new Set()
    if (!T) names.add('world')
    else for (let a = Math.floor((lat - dLat) / T) * T; a <= lat + dLat; a += T) {
      for (let o = Math.floor((lon - dLon) / T) * T; o <= lon + dLon; o += T) {
        const oo = ((((o + 180) % 360) + 360) % 360) - 180
        if (a >= -90 && a < 90) names.add(`${a}_${oo}`)
      }
    }
    const k = new Float64Array(this.S); let E = 0
    for (const name of names) {
      const t = await this.tile(name)
      if (!t) continue
      for (let c = 0; c < t.nCells; c++) {
        const id = t.cellId[c], row = Math.floor(id / ncol), col = id % ncol
        const clat = (row + 0.5) * res - 90, clon = (col + 0.5) * res - 180
        if (Math.abs(clat - lat) > dLat) continue
        const d = haversineKm(lat, lon, clat, clon)
        if (d > R) continue
        const w = Math.exp(-0.5 * (d / hKm) ** 2)
        for (let j = t.offset[c]; j < t.offset[c + 1]; j++) { const v = w * t.count[j]; k[t.species[j]] += v; E += v }
      }
    }
    return { k, E }
  }

  weightsFrom(g, lam, e, lamE) {
    const w = new Float32Array(this.S)
    for (let s = 0; s < this.S; s++) {
      w[s] = (1 - lam) + lam * g[s]
      if (e && lamE > 0) w[s] *= (1 - lamE) + lamE * e[s]
    }
    return w
  }

  // Plausibility per species for {lat, lon} | {ecRegion} | {country}: { mode, g, cfg } or null.
  async plausibilityFor(input) {
    const m = this.meta, st = m.settings
    if (input && Number.isFinite(input.lat) && Number.isFinite(input.lon)) {
      const cfg = Number.isFinite(input.elev) ? st.coords_elev : st.coords_only
      const { k, E } = await this.localCounts(input.lat, input.lon, cfg.h_km)
      return { mode: 'coords', g: plausibility(k, E, m.n_records, this.total, cfg), cfg }
    }
    if (input && input.ecRegion) {
      const j = m.ec_regions.indexOf(input.ecRegion)
      if (j < 0) throw new Error(`unknown Ecuador region ${input.ecRegion}`)
      const k = new Float64Array(this.S); let E = 0
      for (const [s, v] of Object.entries(m.ec_region_counts)) { k[+s] = v[j]; E += v[j] }
      return { mode: 'region', g: plausibility(k, E, m.n_records, this.total, st.ec_region), cfg: st.ec_region }
    }
    if (input && input.country) {
      const k = new Float64Array(this.S); let E = 0
      for (const [s, d] of Object.entries(m.country_counts)) { const v = d[input.country] || 0; k[+s] = v; E += v }
      return { mode: 'country', g: plausibility(k, E, m.n_records, this.total, st.country_only), cfg: st.country_only }
    }
    return null
  }

  // Species weights (Float32Array over meta.species) or null if no input; same API as the reference reader.
  async speciesWeights(input) {
    const p = await this.plausibilityFor(input)
    if (!p) return null
    const hasZ = p.mode === 'coords' && Number.isFinite(input.elev) && p.cfg.lamE > 0
    const e = hasZ ? elevationFactor(input.elev, this.meta.elev_lo, this.meta.elev_hi, p.cfg.sigma) : null
    return this.weightsFrom(p.g, p.cfg.lam, e, hasZ ? p.cfg.lamE : 0)
  }

  // Prior object for rankLeaves (aiPredict.js): per-species weight and "low" flag by name.
  async prior(input) {
    const p = await this.plausibilityFor(input)
    if (!p) return null
    return makePrior(p.mode, p.g, p.cfg.lam, this.index)
  }
}

// { mode, weight(species) -> (1 - lam) + lam * g, low(species) -> g < LOW_G,
//   known(species) }. Unknown species: weight 1, never low.
export function makePrior(mode, g, lam, index) {
  const idx = (sp) => index.get(sp)
  return {
    mode,
    lam,
    known: (sp) => idx(sp) !== undefined,
    weight(sp) { const i = idx(sp); return i === undefined ? 1 : (1 - lam) + lam * g[i] },
    low(sp) { const i = idx(sp); return i !== undefined && g[i] < LOW_G },
    g(sp) { const i = idx(sp); return i === undefined ? null : g[i] },
  }
}

// ---- site loaders (cached; a failed load can be retried) --------------------
const BASE = `${(import.meta.env && import.meta.env.BASE_URL) || '/'}data/geo_prior`

let _gp = null
export function getGeoPrior(fetchImpl) {
  if (!_gp) {
    _gp = new GeoPrior(BASE, fetchImpl).load()
    _gp.catch(() => { _gp = null })
  }
  return _gp
}

let _presence = null
export function getCountryPresence(fetchImpl) {
  if (!_presence) {
    _presence = (fetchImpl || ((u) => fetch(u)))(`${BASE}/country_presence.json`)
      .then((r) => { if (!r.ok) throw new Error(`country presence ${r.status}`); return r.json() })
    _presence.catch(() => { _presence = null })
  }
  return _presence
}

// Location object used by the AI Identifier -> reader input.
//   { mode: 'coords', lat, lon } | { mode: 'country', iso } | { mode: 'region', region }
export function priorInput(loc) {
  if (!loc) return null
  if (loc.mode === 'coords') return { lat: loc.lat, lon: loc.lon }
  if (loc.mode === 'region') return { ecRegion: loc.region }
  if (loc.mode === 'country') return { country: loc.iso }
  return null
}

export function locKey(loc) {
  if (!loc) return ''
  if (loc.mode === 'coords') return `c:${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`
  if (loc.mode === 'region') return `r:${loc.region}`
  return `n:${loc.iso}`
}

const _priors = new Map()   // locKey -> prior (small LRU)
export function cachedPrior(loc) { return _priors.get(locKey(loc)) || null }
export async function resolvePrior(loc, gpPromise = getGeoPrior()) {
  const key = locKey(loc)
  if (!key) return null
  if (_priors.has(key)) return _priors.get(key)
  const gp = await gpPromise
  const prior = await gp.prior(priorInput(loc))
  _priors.set(key, prior)
  if (_priors.size > 24) _priors.delete(_priors.keys().next().value)
  return prior
}

// Ecuador region most supported by the photo: each region scores the photo's top
// species probabilities times the species' share of all records in that region
// (74.6% first on the Ecuador field photos). Returns { region, score } or null.
export function suggestEcRegion(gp, speciesProbs, top = 200) {
  const m = gp?.meta
  if (!m || !m.ec_region_counts) return null
  const R = m.ec_regions.length
  if (!gp._ecTotals) {
    const t = new Float64Array(R)
    for (const v of Object.values(m.ec_region_counts)) for (let j = 0; j < R; j++) t[j] += v[j]
    gp._ecTotals = t
  }
  const sc = new Float64Array(R)
  for (const [sp, p] of speciesProbs.slice(0, top)) {
    const i = gp.index.get(sp)
    const v = i === undefined ? null : m.ec_region_counts[i]
    if (!v) continue
    for (let j = 0; j < R; j++) if (gp._ecTotals[j] > 0) sc[j] += p * v[j] / gp._ecTotals[j]
  }
  let best = -1
  for (let j = 0; j < R; j++) if (sc[j] > 0 && (best < 0 || sc[j] > sc[best])) best = j
  return best < 0 ? null : { region: m.ec_regions[best], score: sc[best] }
}

// "0.99 S, 77.81 W"
export function fmtLatLon(lat, lon, digits = 2) {
  return `${Math.abs(lat).toFixed(digits)} ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(digits)} ${lon < 0 ? 'W' : 'E'}`
}
