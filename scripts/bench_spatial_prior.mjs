// Field benchmark of the AI Identifier location prior through the site's own code
// (rankLeaves + geoSpatial.js, loaded with vite ssrLoadModule). Not shipped.
//
//   node scripts/bench_spatial_prior.mjs [/tmp/field_top200.jsonl] [WingsClassificator repo]
//
// Input rows (same order as live_field_benchmark_v1/cached_v6_probs/predictions.jsonl): { truth, country, leaves: top-200 [[leaf, prob]] }
// from the live head. Locations: reports/geo_spatial_prior_20260927/data/field_locations.json
// (candidate_id -> { latlon, country, elev }). Ecuador regions follow the experiment
// (straight-line Andean crest, Sierra at 1,500 m and above, Galapagos west of 85 W).
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const TOP200 = process.argv[2] || '/tmp/field_top200.jsonl'
const REPO = process.argv[3] || '/home/franz/Documents/CodeProjs/WingsClassificator'
const rows = readFileSync(TOP200, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
// row order = the cached live predictions (image_id = field candidate_id)
const ids = readFileSync(`${REPO}/reports/model_deployment_20260926/live_field_benchmark_v1/cached_v6_probs/predictions.jsonl`, 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l).image_id)
const locs = JSON.parse(readFileSync(`${REPO}/reports/geo_spatial_prior_20260927/data/field_locations.json`, 'utf8'))
if (rows.length !== ids.length) throw new Error(`row count ${rows.length} vs ${ids.length}`)

const crest = (la) => -78.2 + (la - 0.8) * (79.3 - 78.2) / (0.8 + 4.8)
function ecRegion(lat, lon, elev) {
  if (lon < -85) return 'Galapagos'
  if (elev >= 1500) return 'Sierra'
  return lon < crest(lat) ? 'Costa' : 'Oriente'
}

const vite = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { rankLeaves } = await vite.ssrLoadModule('/src/utils/aiPredict.js')
  const spatial = await vite.ssrLoadModule('/src/utils/geoSpatial.js')
  const names = await vite.ssrLoadModule('/src/utils/taxonNames.js')
  names.setTaxonNameMap(JSON.parse(readFileSync('public/data/taxon_name_map.json', 'utf8')))
  const gp = await new spatial.GeoPrior('public/data/geo_prior', async (u) => new Response(await readFile(u))).load()

  const modes = ['none', 'country', 'coords', 'region']
  const hit = Object.fromEntries(modes.map((m) => [m, 0])), n = Object.fromEntries(modes.map((m) => [m, 0]))
  const ecHit = { none: 0, region: 0, country: 0, coords: 0 }; let ecN = 0
  const countryPriors = new Map(), regionPriors = new Map()
  let known = 0, total = 0, tagged = 0
  const t0 = Date.now()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], loc = locs[ids[i]]
    const leaves = names.canonicalLeaves(row.leaves)
    const truth = names.canonical(row.truth)
    const top = (prior) => rankLeaves(leaves, {}, { prior, topK: 1 }).species[0][0]
    const score = (m, prior) => { n[m]++; const ok = top(prior) === truth; if (ok) hit[m]++; return ok }
    score('none', null)
    const iso = loc.country
    if (!countryPriors.has(iso)) countryPriors.set(iso, await gp.prior({ country: iso }))
    const cOk = score('country', countryPriors.get(iso))
    const [lat, lon] = loc.latlon
    const pc = await gp.prior({ lat, lon })
    const kOk = score('coords', pc)
    // how often the truth would carry the "not recorded near here" tag
    const tsp = truth.split(' ').slice(0, 2).join(' ')
    total++; if (pc.known(tsp)) known++; if (pc.low(tsp)) tagged++
    if (iso === 'EC') {
      ecN++
      const reg = ecRegion(lat, lon, loc.elev)
      if (!regionPriors.has(reg)) regionPriors.set(reg, await gp.prior({ ecRegion: reg }))
      const rOk = score('region', regionPriors.get(reg))
      if (rOk) ecHit.region++
      if (cOk) ecHit.country++
      if (kOk) ecHit.coords++
      if (top(null) === truth) ecHit.none++
    }
  }
  const pct = (a, b) => (100 * a / b).toFixed(2)
  const out = {
    photos: rows.length,
    species_top1: Object.fromEntries(modes.map((m) => [m, { n: n[m], top1: +pct(hit[m], n[m]) }])),
    ecuador_photos: { n: ecN, ...Object.fromEntries(Object.entries(ecHit).map(([k, v]) => [k, +pct(v, ecN)])) },
    truth_species_known_to_prior: +pct(known, total),
    truth_tagged_not_recorded_near_here: +pct(tagged, total),
    seconds: (Date.now() - t0) / 1000,
  }
  console.log(JSON.stringify(out, null, 2))
} finally {
  await vite.close()
}
