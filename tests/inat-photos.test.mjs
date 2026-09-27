import test from 'node:test'
import assert from 'node:assert/strict'
import { createInatClient, parseObservations, photoSize, taxonMatch, inatSearchUrl } from '../src/utils/inatPhotos.js'
import { webImageUrl, unproxiedUrl } from '../src/utils/imageProxy.js'

const obs = (id, name, rank = name.split(' ').length > 2 ? 'subspecies' : 'species', extra = {}) => ({
  id, uri: `https://www.inaturalist.org/observations/${id}`, place_guess: `Place ${id}`,
  user: { login: `user${id}`, name: id % 2 ? `Observer ${id}` : '' },
  taxon: { name, rank, iconic_taxon_name: 'Insecta' },
  photos: [{ url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${id}/square.jpg`, attribution: '(c) someone, CC BY-NC' }],
  ...extra,
})

// Mock fetch: routes by URL; records calls and the virtual time they started.
function mockFetch(routes, clock) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push({ url: String(url), at: clock ? clock.t : 0 })
    const u = new URL(url)
    for (const [match, body] of routes) {
      if (match(u)) {
        if (body instanceof Error) return { ok: false, status: 429, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => body }
      }
    }
    return { ok: true, status: 200, json: async () => ({ total_results: 0, results: [] }) }
  }
  return { fetchImpl, calls }
}
const byTaxon = (name, place) => (u) => u.pathname.endsWith('/observations') && u.searchParams.get('taxon_name') === name &&
  (place === undefined ? true : (u.searchParams.get('place_id') || '') === String(place || ''))
const fakeClock = () => { const c = { t: 0 }; c.now = () => c.t; c.sleep = async (ms) => { c.t += ms }; return c }
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m } }

test('photo size segment is swapped and search links are encoded', () => {
  const sq = 'https://inaturalist-open-data.s3.amazonaws.com/photos/64021387/square.jpg'
  assert.equal(photoSize(sq, 'medium'), 'https://inaturalist-open-data.s3.amazonaws.com/photos/64021387/medium.jpg')
  assert.equal(photoSize('https://static.inaturalist.org/photos/1/square.JPEG', 'small'), 'https://static.inaturalist.org/photos/1/small.JPEG')
  assert.match(inatSearchUrl('Pteronymia ozia'), /taxon_name=Pteronymia%20ozia/)
})

test('taxon checks accept the taxon and descendants, synonyms only for species, never non-insects', () => {
  assert.equal(taxonMatch('Pteronymia ozia', { name: 'Pteronymia ozia', rank: 'species' }), 'match')
  assert.equal(taxonMatch('Pteronymia ozia', { name: 'Pteronymia ozia tanampaya', rank: 'subspecies' }), 'match')
  assert.equal(taxonMatch('Pteronymia ozia', { name: 'Pteronymia oziana', rank: 'species' }), 'synonym')
  assert.equal(taxonMatch('Pteronymia ozia', { name: 'Pteronymia', rank: 'genus' }), null)
  assert.equal(taxonMatch('Pteronymia ozia tanampaya', { name: 'Pteronymia ozia', rank: 'species' }), null)
  assert.equal(taxonMatch('Pteronymia ozia', { name: 'Pteronymia ozia', rank: 'species', iconic_taxon_name: 'Plantae' }), null)
  const parsed = parseObservations('Godyris dircenna', { results: [obs(1, 'Godyris zavaleta'), obs(2, 'Godyris zavaleta')] })
  assert.equal(parsed.resolvedAs, 'Godyris zavaleta')
  assert.equal(parsed.photos.length, 2)
  const p = parseObservations('Pteronymia ozia', { results: [obs(3, 'Pteronymia ozia'), obs(4, 'Pteronymia aletta')] })
  assert.deepEqual(p.photos.map((x) => x.id), [3])   // exact matches win over synonyms
  // served through wsrv.nl, with the original iNat size inside
  const inner = (u) => new URL(u).searchParams.get('url')
  assert.match(p.photos[0].url, /^https:\/\/wsrv\.nl\/\?url=.*&w=900/)
  assert.equal(inner(p.photos[0].url).endsWith('/large.jpg'), true)
  assert.equal(inner(p.photos[0].thumb).endsWith('/small.jpg'), true)
  assert.equal(p.photos[0].observer, 'Observer 3')
  assert.equal(p.photos[0].link, 'https://www.inaturalist.org/observations/3')
  assert.equal('license' in p.photos[0] || 'attribution' in p.photos[0], false)
})

test('subspecies with no photos falls back to the species', async () => {
  const clock = fakeClock()
  const { fetchImpl, calls } = mockFetch([[byTaxon('Pteronymia ozia'), { results: [obs(5, 'Pteronymia ozia'), obs(6, 'Pteronymia ozia tanampaya')] }]], clock)
  const c = createInatClient({ fetchImpl, storage: null, now: clock.now, sleep: clock.sleep })
  const r = await c.fieldPhotos('Pteronymia ozia foo')
  assert.equal(r.speciesFallback, true)
  assert.equal(r.shownTaxon, 'Pteronymia ozia')
  assert.equal(r.photos.length, 2)
  assert.equal(calls.length, 2)
  const first = new URL(calls[0].url)
  assert.equal(first.searchParams.get('taxon_name'), 'Pteronymia ozia foo')
  assert.equal(first.searchParams.get('quality_grade'), 'research')
  assert.equal(first.searchParams.get('photos'), 'true')
  assert.equal(first.searchParams.get('per_page'), '12')
  assert.equal(first.searchParams.get('order_by'), 'votes')
  assert.equal(first.searchParams.has('place_id'), false)
  const none = await c.fieldPhotos('Nonexistus fakeus')
  assert.deepEqual(none.photos, [])
})

test('a selected country resolves the place once and falls back to all places when empty', async () => {
  const clock = fakeClock()
  const { fetchImpl, calls } = mockFetch([
    [(u) => u.pathname.endsWith('/places/autocomplete'), { results: [{ id: 185940, name: 'Bosque, Ecuador', admin_level: null }, { id: 7512, name: 'Ecuador', admin_level: 0 }] }],
    [byTaxon('Pteronymia ozia', 7512), { results: [obs(7, 'Pteronymia ozia')] }],
    [byTaxon('Dircenna dero', 7512), { results: [] }],
    [byTaxon('Dircenna dero', ''), { results: [obs(8, 'Dircenna dero')] }],
  ], clock)
  const c = createInatClient({ fetchImpl, storage: null, now: clock.now, sleep: clock.sleep })
  const a = await c.fieldPhotos('Pteronymia ozia', { country: 'Ecuador' })
  assert.equal(a.place, 'Ecuador')
  assert.equal(a.placeFallback, false)
  assert.deepEqual(a.photos.map((p) => p.id), [7])
  const b = await c.fieldPhotos('Dircenna dero', { country: 'Ecuador' })
  assert.equal(b.placeFallback, true)
  assert.equal(b.place, '')
  assert.deepEqual(b.photos.map((p) => p.id), [8])
  assert.equal(calls.filter((x) => x.url.includes('/places/')).length, 1)
})

test('results are cached in memory and sessionStorage; failures are not cached', async () => {
  const clock = fakeClock()
  const storage = memStorage()
  const { fetchImpl, calls } = mockFetch([[byTaxon('Pteronymia ozia'), { results: [obs(9, 'Pteronymia ozia')] }]], clock)
  const c1 = createInatClient({ fetchImpl, storage, now: clock.now, sleep: clock.sleep })
  await c1.fieldPhotos('Pteronymia ozia')
  await c1.fieldPhotos('Pteronymia ozia')
  assert.equal(calls.length, 1)
  const c2 = createInatClient({ fetchImpl, storage, now: clock.now, sleep: clock.sleep })
  const again = await c2.fieldPhotos('Pteronymia ozia')
  assert.equal(calls.length, 1)             // served from sessionStorage
  assert.equal(again.photos[0].id, 9)

  let fail = true
  const flaky = async (url) => (fail ? { ok: false, status: 429, json: async () => ({}) } : fetchImpl(url))
  const c3 = createInatClient({ fetchImpl: flaky, storage: null, now: clock.now, sleep: clock.sleep })
  await assert.rejects(c3.fieldPhotos('Pteronymia ozia'))
  fail = false
  const ok = await c3.fieldPhotos('Pteronymia ozia')
  assert.equal(ok.photos.length, 1)
})

test('token bucket: a burst goes out at once, then one per second, priority jumps the queue', async () => {
  const clock = fakeClock()
  const { fetchImpl, calls } = mockFetch([], clock)
  const c = createInatClient({ fetchImpl, storage: null, burst: 3, refillPerSec: 1, maxConcurrent: 2, now: clock.now, sleep: clock.sleep })
  const jobs = ['A a', 'B b', 'C c', 'D d', 'E e'].map((t) => c.fieldPhotos(t))
  const pri = c.fieldPhotos('Z z', { priority: true })
  await Promise.all([...jobs, pri])
  const starts = calls.map((x) => x.at)
  assert.deepEqual(starts.slice(0, 3), [0, 0, 0])            // burst of 3 without waiting
  for (let i = 3; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 1000, `gap ${i}`)
  const order = calls.map((x) => new URL(x.url).searchParams.get('taxon_name'))
  assert.deepEqual(order.slice(0, 2), ['A a', 'B b'])        // already running
  assert.ok(order.indexOf('Z z') <= 2, 'selected taxon goes next')
})

test('webImageUrl proxies web images once and unproxiedUrl recovers the original', () => {
  const u = 'https://api.gbif.org/v1/image/unsafe/x.jpg?a=1&b=2'
  const w = webImageUrl(u, 300)
  assert.match(w, /^https:\/\/wsrv\.nl\/\?url=/)
  assert.equal(unproxiedUrl(w), u)
  assert.equal(webImageUrl(w, 300), w)
  assert.equal(webImageUrl('data:image/png;base64,xx', 300), 'data:image/png;base64,xx')
})
