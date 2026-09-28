// Field photos from iNaturalist for the AI Identifier reference panel and the
// candidate-row thumbnails. The prebuilt index (fieldPhotoIndex.js) answers
// first; taxa it lacks use the live public API (CORS open, no key).
//
// Rate limits: a token bucket lets the first 10 requests (the visible candidates)
// go out at once, 4 in flight, then 1 per second, iNaturalist's recommended
// 60/min per client. The selected taxon can jump the queue (priority). Photos are
// served through wsrv.nl (cached, resized WebP), with a direct-URL fallback. Results are cached per taxon + place in memory and in
// sessionStorage, and identical in-flight requests are shared.
//
// Taxon checks: iNat's taxon_name also returns descendants (a species query can
// return subspecies observations) and may resolve a synonym. We keep observations
// whose taxon is the requested one or a descendant of it. For a species request we
// also accept a species-or-lower taxon under another name (a synonym) and report it
// as `resolvedAs`; for a subspecies request anything else is dropped so the caller
// falls back to the species.

const API = 'https://api.inaturalist.org/v1'
const CACHE_PREFIX = 'inat-photos:v1:'
const PER_PAGE = 12
const SPECIES_OR_LOWER = new Set(['species', 'hybrid', 'subspecies', 'variety', 'form', 'infrahybrid'])

import { webImageUrl } from './imageProxy.js'
import { createFieldPhotoIndex } from './fieldPhotoIndex.js'
import { loadTaxonNames, lookupOrder } from './taxonNames.js'

// Names to query for a taxon: itself, then its canonical name and aliases.
async function defaultNamesFor(name) {
  await loadTaxonNames()
  return lookupOrder(name)
}

export const speciesOf = (t) => String(t || '').trim().split(/\s+/).slice(0, 2).join(' ')
export const isSubspecies = (t) => String(t || '').trim().split(/\s+/).length >= 3

// iNat photo URLs end in /square.jpg; swap the size segment for other sizes.
export function photoSize(url, size) {
  return String(url || '').replace(/\/(square|thumb|small|medium|large|original)\.(jpe?g|png|gif)/i, `/${size}.$2`)
}

export function inatSearchUrl(name) {
  return `https://www.inaturalist.org/observations?taxon_name=${encodeURIComponent(name)}&quality_grade=research`
}

// 'match' = requested taxon or a descendant, 'synonym' = accepted under another
// name (species requests only), null = reject.
export function taxonMatch(requested, obsTaxon) {
  if (!obsTaxon || !obsTaxon.name) return null
  if (obsTaxon.iconic_taxon_name && obsTaxon.iconic_taxon_name !== 'Insecta') return null
  const want = requested.trim().toLowerCase()
  const got = obsTaxon.name.trim().toLowerCase()
  if (got === want || got.startsWith(want + ' ')) return 'match'
  if (!isSubspecies(requested) && SPECIES_OR_LOWER.has(obsTaxon.rank)) return 'synonym'
  return null
}

// Pure: API response -> { photos, resolvedAs }.
export function parseObservations(requested, json) {
  const matched = [], synonyms = []
  for (const obs of json?.results || []) {
    const photo = obs?.photos?.[0]
    if (!photo?.url) continue
    const kind = taxonMatch(requested, obs.taxon)
    if (!kind) continue
    const entry = {
      id: obs.id,
      url: webImageUrl(photoSize(photo.url, 'large'), 900),
      thumb: webImageUrl(photoSize(photo.url, 'small'), 160),
      small: photoSize(photo.url, 'small'),
      place: obs.place_guess || '',
      observer: obs.user?.name || obs.user?.login || '',
      link: obs.uri || (obs.id ? `https://www.inaturalist.org/observations/${obs.id}` : ''),
      taxon: obs.taxon.name,
    }
    ;(kind === 'match' ? matched : synonyms).push(entry)
  }
  if (matched.length) return { photos: matched, resolvedAs: '' }
  if (synonyms.length) return { photos: synonyms, resolvedAs: speciesOf(synonyms[0].taxon) }
  return { photos: [], resolvedAs: '' }
}

function defaultStorage() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null } catch { return null }
}

export function createInatClient({
  fetchImpl = (...a) => globalThis.fetch(...a),
  storage = defaultStorage(),
  burst = 10,            // requests allowed at once before throttling
  refillPerSec = 1,       // sustained rate: 60/min, iNaturalist's recommended ceiling per client
  maxConcurrent = 4,
  timeoutMs = 12000,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  namesFor = defaultNamesFor,   // taxon -> names to try (old / new names of a renamed taxon)
  index = null,           // prebuilt photo index: async name -> { photos } | null (fieldPhotoIndex.js)
} = {}) {
  const memory = new Map()      // key -> Promise
  const queue = []              // pending { run, resolve, reject }
  let pumping = false
  let active = 0
  let tokens = burst
  let lastRefill = now()

  // Token bucket: the first `burst` requests go out immediately (up to
  // `maxConcurrent` in flight), then one per 1/refillPerSec seconds.
  function refill() {
    const t = now()
    tokens = Math.min(burst, tokens + ((t - lastRefill) / 1000) * refillPerSec)
    lastRefill = t
  }
  async function pump() {
    if (pumping) return
    pumping = true
    try {
      while (queue.length && active < maxConcurrent) {
        refill()
        if (tokens < 1) { await sleep(Math.ceil(((1 - tokens) / refillPerSec) * 1000)); continue }
        tokens -= 1
        const job = queue.shift()
        active += 1
        let started
        try { started = Promise.resolve(job.run()) } catch (e) { started = Promise.reject(e) }
        started.then(job.resolve, job.reject).finally(() => { active -= 1; pump() })
      }
    } finally {
      pumping = false
    }
  }
  function schedule(run, priority = false) {
    return new Promise((resolve, reject) => {
      const job = { run, resolve, reject }
      if (priority) queue.unshift(job); else queue.push(job)
      pump()
    })
  }

  function readStore(key) {
    try { const s = storage?.getItem(CACHE_PREFIX + key); return s ? JSON.parse(s) : null } catch { return null }
  }
  function writeStore(key, value) {
    try { storage?.setItem(CACHE_PREFIX + key, JSON.stringify(value)) } catch { /* quota or disabled */ }
  }

  // Memoise per key; failures are not cached so a later call can retry.
  function cached(key, loader) {
    if (memory.has(key)) return memory.get(key)
    const stored = readStore(key)
    if (stored) { const p = Promise.resolve(stored); memory.set(key, p); return p }
    const p = loader().then((v) => { writeStore(key, v); return v })
    p.catch(() => memory.delete(key))
    memory.set(key, p)
    return p
  }

  async function getJson(url, priority) {
    return schedule(async () => {
      // a stalled request must not hold a concurrency slot forever
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
      try {
        const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: ctrl?.signal })
        if (!res.ok) throw new Error(`iNaturalist ${res.status}`)
        return await res.json()
      } finally {
        if (timer) clearTimeout(timer)
      }
    }, priority)
  }

  // Country name -> iNat place id (country-level place), or null.
  function resolvePlace(country, { priority = false } = {}) {
    if (!country) return Promise.resolve(null)
    return cached(`place:${country}`, async () => {
      const json = await getJson(`${API}/places/autocomplete?q=${encodeURIComponent(country)}`, priority)
      const list = json?.results || []
      const lc = country.toLowerCase()
      const hit = list.find((p) => p.admin_level === 0 && String(p.name).toLowerCase() === lc)
        || list.find((p) => p.admin_level === 0)
      return hit ? hit.id : null
    })
  }

  function observations(name, placeId, { priority = false } = {}) {
    return cached(`obs:${name}|${placeId || ''}`, async () => {
      const params = new URLSearchParams({
        taxon_name: name, quality_grade: 'research', photos: 'true',
        per_page: String(PER_PAGE), order_by: 'votes',
      })
      if (placeId) params.set('place_id', String(placeId))
      const json = await getJson(`${API}/observations?${params}`, priority)
      return parseObservations(name, json)
    })
  }

  // Field photos for a taxon. Each level tries the requested name, then the other
  // names of a renamed taxon (taxonNames.js); subspecies with no photos fall back
  // to the species; a country filter with no photos falls back to all places.
  // -> { photos, requested, shownTaxon, speciesFallback, placeFallback, place, resolvedAs }
  async function fieldPhotos(taxon, { country = '', priority = false } = {}) {
    const requested = String(taxon || '').trim()
    const empty = { photos: [], requested, shownTaxon: requested, speciesFallback: false, placeFallback: false, place: '', resolvedAs: '' }
    if (!requested) return empty
    const levels = isSubspecies(requested) ? [requested, speciesOf(requested)] : [requested]
    const namesByLevel = []
    for (const level of levels) {
      let names = [level]
      try { names = (await namesFor(level)) || [level] } catch { names = [level] }
      if (!names.includes(level)) names.unshift(level)
      namesByLevel.push([level, names])
    }
    // 1. the prebuilt index (no network wait beyond one small static file)
    if (index) {
      for (const [level, names] of namesByLevel) {
        for (const name of names) {
          let hit = null
          try { hit = await index(name) } catch { hit = null }
          if (!hit?.photos?.length) continue
          const lc = country.toLowerCase()
          const here = country ? hit.photos.filter((p) => String(p.country || '').toLowerCase() === lc) : []
          return {
            photos: (here.length ? here : hit.photos).slice(0, PER_PAGE), requested, shownTaxon: name,
            resolvedAs: name !== level ? name : '',
            speciesFallback: level !== requested,
            placeFallback: !!country && !here.length,
            place: here.length ? country : '',
          }
        }
      }
    }
    // 2. live iNaturalist search
    let placeId = null
    if (country) { try { placeId = await resolvePlace(country, { priority }) } catch { placeId = null } }
    for (const [level, names] of namesByLevel) {
      for (const name of names) {
        const tries = placeId ? [placeId, null] : [null]
        for (const pid of tries) {
          const r = await observations(name, pid, { priority })
          if (r.photos.length) {
            return {
              photos: r.photos, requested, shownTaxon: name,
              // found under another name of the taxon: say which
              resolvedAs: r.resolvedAs || (name !== level ? name : ''),
              speciesFallback: level !== requested,
              placeFallback: !!placeId && !pid,
              place: pid ? country : '',
            }
          }
        }
      }
    }
    return empty
  }

  return { fieldPhotos, resolvePlace, observations, _queue: queue }
}

let _client = null
export function inatClient() {
  if (!_client) _client = createInatClient({ index: createFieldPhotoIndex() })
  return _client
}
export const fieldPhotos = (taxon, opts) => inatClient().fieldPhotos(taxon, opts)
