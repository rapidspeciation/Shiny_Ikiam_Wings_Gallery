// Spatial GBIF location prior: reader (golden values from the Python reference),
// EXIF GPS parsing, rankLeaves with coordinates / country / Ecuador region,
// off-region tags and location suggestions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const fileFetch = async (u) => new Response(await readFile(u))
const DIR = 'public/data/geo_prior'

let vite, geo, spatial, predict, exif, gp
test.before(async () => {
  vite = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  spatial = await vite.ssrLoadModule('/src/utils/geoSpatial.js')
  geo = await vite.ssrLoadModule('/src/utils/geoPrior.js')
  predict = await vite.ssrLoadModule('/src/utils/aiPredict.js')
  exif = await vite.ssrLoadModule('/src/utils/exifGps.js')
  gp = await new spatial.GeoPrior(DIR, fileFetch).load()
})
test.after(async () => { await vite?.close() })

// ---- reader (ported from the export's tests) --------------------------------
test('haversine', () => {
  assert.ok(Math.abs(spatial.haversineKm(0, 0, 0, 1) - 111.19) < 0.1)
})

test('plausibility: neutral for species without records and in empty places', () => {
  const { plausibility } = spatial
  const cfg = { variant: 'ratio', a: 10, b: 0.1 }
  const g = plausibility(new Float64Array([0, 0, 5]), 0, [0, 100, 100], 200, cfg)
  assert.equal(g[0], 1); assert.equal(g[1], 1)
  const g2 = plausibility(new Float64Array([0, 0, 1000]), 1000, [0, 100, 100], 200, cfg)
  assert.equal(g2[0], 1); assert.ok(Math.abs(g2[1] - 0.099) < 1e-3); assert.equal(g2[2], 1)
  const g3 = plausibility(new Float64Array([0, 0, 10]), 10, [0, 100, 100], 200, { variant: 'occ', b: 10 })
  assert.equal(g3[0], 1); assert.equal(g3[1], 0); assert.ok(Math.abs(g3[2] - (1 - Math.exp(-1))) < 1e-6)
})

test('elevation factor', () => {
  const e = spatial.elevationFactor(3000, [0, 2500, null], [1000, 3500, null], 200)
  assert.ok(e[0] < 1e-6); assert.equal(e[1], 1); assert.equal(e[2], 1)
  assert.ok(spatial.elevationFactor(null, [0], [10], 100)[0] === 1)
})

test('tile parser round trip on the shipped tile', async () => {
  const t = await gp.tile(gp.meta.tiles[0])
  assert.equal(t.offset[t.nCells], t.nPairs)
  for (let i = 0; i < t.nPairs; i++) assert.ok(t.species[i] < gp.S)
})

test('shipped files match the tuned settings', () => {
  const st = gp.meta.settings
  assert.deepEqual([st.coords_only.variant, st.coords_only.h_km, st.coords_only.b, st.coords_only.lam], ['occ', 100, 10, 0.95])
  assert.deepEqual([st.country_only.b, st.country_only.lam], [30, 0.98])
  assert.deepEqual([st.ec_region.b, st.ec_region.lam], [30, 0.99])
  assert.deepEqual(gp.meta.ec_regions, spatial.EC_REGIONS)
})

test('matches the Python reference (golden values)', async () => {
  const gold = JSON.parse(await readFile('tests/fixtures/geo_prior_golden.json', 'utf8'))
  for (const c of gold) {
    const i = c.input
    const w = await gp.speciesWeights({ lat: i.lat, lon: i.lon, elev: i.elev, country: i.country, ecRegion: i.ec_region })
    let sum = 0; for (const v of w) sum += v
    assert.ok(Math.abs(sum - c.sum) / c.sum < 1e-4, `sum ${JSON.stringify(i)} ${sum} vs ${c.sum}`)
    for (const [s, v] of Object.entries(c.probe)) assert.ok(Math.abs(w[+s] - v) < 1e-4, `species ${s} ${JSON.stringify(i)}: ${w[+s]} vs ${v}`)
  }
})

test('prior(): weights by species name, unknown species neutral', async () => {
  const p = await gp.prior({ lat: -0.99, lon: -77.81 })
  assert.equal(p.mode, 'coords')
  assert.ok(Math.abs(p.weight('Papilio machaon') - 0.05) < 1e-6)   // no records near Tena: (1 - lam)
  assert.ok(p.weight('Heliconius erato') > 0.99)
  assert.equal(p.weight('Nonexistent species'), 1)
  assert.equal(p.low('Nonexistent species'), false)
  assert.equal(p.low('Papilio machaon'), true)
})

test('reader accepts files the server already decompressed (Content-Encoding: gzip)', async () => {
  const { gunzipSync } = await import('node:zlib')
  const plain = await new spatial.GeoPrior(DIR, async (u) => new Response(gunzipSync(await readFile(u)))).load()
  assert.equal(plain.S, gp.S)
  const w1 = await plain.speciesWeights({ lat: -0.23, lon: -78.51 }), w2 = await gp.speciesWeights({ lat: -0.23, lon: -78.51 })
  assert.deepEqual(Array.from(w1.slice(0, 50)), Array.from(w2.slice(0, 50)))
})

test('site loaders cache and recover from a failed load', async () => {
  let calls = 0
  const failing = async () => { calls++; return new Response('nope', { status: 404 }) }
  await assert.rejects(spatial.getGeoPrior(failing))
  const ok = await spatial.getGeoPrior(async (u) => fileFetch(u.replace(/^.*data\/geo_prior/, DIR)))
  assert.equal(ok.S, gp.S)
  assert.equal(await spatial.getGeoPrior(failing), ok)   // cached after success
  assert.equal(calls, 1)
})

// ---- rankLeaves ---------------------------------------------------------------
const LEAVES = [
  ['Papilio machaon britannicus', 0.30], ['Papilio machaon gorganus', 0.10],   // Europe
  ['Heliconius erato lativitta', 0.35],
  ['Heliconius charithonia', 0.05],
  ['Mystery species', 0.20],                                                    // unknown to the export
]
const row = (arr, name) => arr.find((r) => r[0] === name)

test('rankLeaves with coordinates re-ranks per species and tags "not recorded near here"', async () => {
  const none = predict.rankLeaves(LEAVES, {}, {})
  assert.equal(none.species[0][0], 'Papilio machaon')
  assert.ok(none.species_all.every((r) => r[2] === 0))
  assert.equal(none.prior_mode, '')

  const prior = await gp.prior({ lat: -0.99, lon: -77.81 })
  const r = predict.rankLeaves(LEAVES, {}, { prior })
  assert.equal(r.prior_mode, 'coords')
  assert.equal(r.oor_label, 'not recorded near here')
  assert.equal(r.species[0][0], 'Heliconius erato')
  assert.equal(row(r.species_all, 'Papilio machaon')[2], 1)
  assert.equal(row(r.subspecies_all, 'Papilio machaon britannicus')[2], 1)
  assert.equal(row(r.species_all, 'Heliconius erato')[2], 0)
  assert.equal(row(r.species_all, 'Mystery species')[2], 0)            // unknown -> neutral, no tag
  assert.equal(row(r.genus_all, 'Papilio')[2], 1)                      // no known Papilio species near here
  assert.equal(row(r.genus_all, 'Heliconius')[2], 0)
  assert.equal(row(r.genus_all, 'Mystery')[2], 0)
  // weights: leaf p * ((1 - lam) + lam * g), renormalised
  const w = (n) => prior.weight(n)
  const raw = { pm: 0.4 * w('Papilio machaon'), he: 0.35 * w('Heliconius erato'), hc: 0.05 * w('Heliconius charithonia'), my: 0.2 }
  const tot = raw.pm + raw.he + raw.hc + raw.my
  assert.ok(Math.abs(row(r.species_all, 'Mystery species')[1] - Math.round(1e4 * raw.my / tot) / 1e4) < 2e-4)
  const sum = r.species_all.reduce((a, b) => a + b[1], 0)
  assert.ok(Math.abs(sum - 1) < 1e-3)
})

test('rankLeaves with a country and an Ecuador region use "off-region"', async () => {
  const ec = predict.rankLeaves(LEAVES, {}, { prior: await gp.prior({ country: 'EC' }) })
  assert.equal(ec.prior_mode, 'country')
  assert.equal(ec.oor_label, 'off-region')
  assert.equal(ec.species[0][0], 'Heliconius erato')
  assert.equal(row(ec.species_all, 'Papilio machaon')[2], 1)
  // Galapagos: Heliconius erato is not recorded there
  const gal = predict.rankLeaves(LEAVES, {}, { prior: await gp.prior({ ecRegion: 'Galapagos' }) })
  assert.equal(gal.prior_mode, 'region')
  assert.equal(row(gal.species_all, 'Heliconius erato')[2], 1)
  assert.equal(gal.species[0][0], 'Mystery species')
  // a region is milder than the tags suggest: lam 0.99 keeps 1% of the weight
  assert.ok(row(gal.species_all, 'Heliconius erato')[1] > 0)
})

test('rankLeaves falls back to the checklist rule for a country without a prior', () => {
  const ck = { 'Papilio machaon': { countries: { Spain: 1 } }, 'Heliconius erato': { countries: { Ecuador: 1 } } }
  const r = predict.rankLeaves(LEAVES, ck, { country: 'Ecuador' })
  assert.equal(r.oor_label, 'off-region')
  assert.equal(row(r.species_all, 'Papilio machaon')[2], 1)
  assert.equal(r.species[0][0], 'Heliconius erato')
})

// ---- suggestions ----------------------------------------------------------------
test('suggestLocations: top 3 countries by prediction mass from the presence table', async () => {
  const presence = JSON.parse(readFileSync(`${DIR}/country_presence.json`, 'utf8'))
  const leaves = [['Heliconius erato lativitta', 0.5], ['Heliconius erato favorinus', 0.1], ['Oleria onega', 0.3], ['Mystery species', 0.1]]
  const s = geo.suggestLocations(presence, leaves)
  assert.equal(s.length, 3)
  assert.ok(s.every((x) => x.kind === 'country' && /^[A-Z]{2}$/.test(x.iso)))
  assert.ok(s.some((x) => x.iso === 'EC'))
  assert.ok(s[0].score >= s[1].score && s[1].score >= s[2].score)
  const small = { 'A b': ['EC', 'PE'], 'C d': ['CO'] }
  assert.deepEqual(geo.suggestLocations(small, [['A b x', 0.6], ['C d', 0.3], ['E f', 0.1]]).map((x) => x.iso), ['EC', 'PE', 'CO'])
  assert.deepEqual(geo.suggestLocations(small, [['E f', 1]]), [])
  assert.deepEqual(geo.suggestLocations(null, [['A b', 1]]), [])
})

test('suggestEcRegion picks the region with the largest share of its records', () => {
  const galapagos = spatial.suggestEcRegion(gp, [['Danaus plexippus', 0.2], ['Leptotes parrhasioides', 0.8]])
  assert.equal(galapagos?.region, 'Galapagos')
  const oriente = spatial.suggestEcRegion(gp, [['Heliconius sara', 0.5], ['Heliconius erato', 0.3], ['Oleria onega', 0.2]])
  assert.ok(spatial.EC_REGIONS.includes(oriente.region))
  assert.equal(spatial.suggestEcRegion(gp, [['Mystery species', 1]]), null)
})

test('country names and checklist fallback names', () => {
  assert.equal(geo.countryName('EC'), 'Ecuador')
  assert.equal(geo.checklistCountry('GF'), 'French-Guiana')
  assert.equal(geo.checklistCountry('PE'), 'Peru')
  const list = geo.countryList({ a: ['PE', 'EC'], b: ['EC', 'CO'] })
  assert.deepEqual(list.map((c) => c.iso), ['CO', 'EC', 'PE'])
  assert.equal(spatial.fmtLatLon(-0.9912, -77.8098), '0.99 S, 77.81 W')
  assert.equal(spatial.fmtLatLon(4.61, 74.08), '4.61 N, 74.08 E')
})

// ---- EXIF GPS -------------------------------------------------------------------
test('EXIF GPS: reads a little-endian JPEG fixture', () => {
  const g = exif.readJpegGps(readFileSync('tests/fixtures/gps_ec.jpg'))
  assert.ok(Math.abs(g.lat + 0.99) < 1e-6 && Math.abs(g.lon + 77.81) < 1e-6, JSON.stringify(g))
  assert.equal(exif.readJpegGps(readFileSync('tests/fixtures/no_gps.jpg')), null)
})

// Hand-built big-endian TIFF with GPS N 4 36' 36", E 74 4' 48" inside APP1, after an APP0.
function bigEndianJpeg({ latRef = 'N', lonRef = 'E', zero = false } = {}) {
  const t = new DataView(new ArrayBuffer(200))
  t.setUint16(0, 0x4d4d); t.setUint16(2, 42); t.setUint32(4, 8)
  // IFD0 at 8: one entry, GPS pointer -> 26
  t.setUint16(8, 1); t.setUint16(10, 0x8825); t.setUint16(12, 4); t.setUint32(14, 1); t.setUint32(18, 26); t.setUint32(22, 0)
  // GPS IFD at 26: 4 entries, rationals at 80 and 104
  t.setUint16(26, 4)
  const ent = (i, tag, type, count, v) => { const e = 28 + 12 * i; t.setUint16(e, tag); t.setUint16(e + 2, type); t.setUint32(e + 4, count); t.setUint32(e + 8, v) }
  ent(0, 1, 2, 2, latRef.charCodeAt(0) << 24)
  ent(1, 2, 5, 3, 80)
  ent(2, 3, 2, 2, lonRef.charCodeAt(0) << 24)
  ent(3, 4, 5, 3, 104)
  const rat = (o, vals) => vals.forEach(([n, d], i) => { t.setUint32(o + 8 * i, n); t.setUint32(o + 8 * i + 4, d) })
  rat(80, zero ? [[0, 1], [0, 1], [0, 1]] : [[4, 1], [36, 1], [3600, 100]])
  rat(104, zero ? [[0, 1], [0, 1], [0, 1]] : [[74, 1], [4, 1], [48, 1]])
  const tiff = new Uint8Array(t.buffer, 0, 128)
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const hdr = [0x45, 0x78, 0x69, 0x66, 0, 0]
  const len = 2 + hdr.length + tiff.length
  return new Uint8Array([0xff, 0xd8, ...app0, 0xff, 0xe1, len >> 8, len & 255, ...hdr, ...tiff, 0xff, 0xda, 0, 2, 0xff, 0xd9])
}

test('EXIF GPS: big-endian TIFF, hemisphere refs, 0/0 and malformed input', () => {
  const g = exif.readJpegGps(bigEndianJpeg())
  assert.ok(Math.abs(g.lat - (4 + 36 / 60 + 36 / 3600)) < 1e-9 && Math.abs(g.lon - (74 + 4 / 60 + 48 / 3600)) < 1e-9)
  const sw = exif.readJpegGps(bigEndianJpeg({ latRef: 'S', lonRef: 'W' }))
  assert.ok(sw.lat < 0 && sw.lon < 0)
  assert.equal(exif.readJpegGps(bigEndianJpeg({ zero: true })), null)
  assert.equal(exif.readJpegGps(bigEndianJpeg().slice(0, 60)), null)   // truncated
  assert.equal(exif.readJpegGps(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null)   // PNG
  assert.equal(exif.readJpegGps(new Uint8Array(0)), null)
})

test('readGpsFromFile reads JPEG files only', async () => {
  const buf = readFileSync('tests/fixtures/gps_ec.jpg')
  const g = await exif.readGpsFromFile(new File([buf], 'x.jpg', { type: 'image/jpeg' }))
  assert.ok(Math.abs(g.lat + 0.99) < 1e-6)
  assert.equal(await exif.readGpsFromFile(new File([buf], 'x.png', { type: 'image/png' })), null)
  assert.equal(await exif.readGpsFromFile(null), null)
})
