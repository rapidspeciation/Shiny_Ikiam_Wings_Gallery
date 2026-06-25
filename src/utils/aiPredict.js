// AI ID prediction pipeline (client side).
//
// The backend (HF Space) returns RAW per-leaf probabilities (no geographic prior).
// Inference runs ONCE per photo; the geographic prior is a *pure* client-side
// re-rank (rankLeaves) so the user can change country/side after the fact — or let
// us guess it — without re-running the model. rankLeaves marginalises the weighted
// leaves into the genus/species/subspecies shape PredictionPanel.vue renders.
//
// Set VITE_AIID_API to the HF Space origin to use the real model; otherwise a
// deterministic mock (real Ithomiini taxa) runs so the whole flow is demoable.
import { entryFor, geoWeight, isOffRegion, DEFAULT_EPS } from './geoPrior.js'

const API_BASE = (import.meta.env.VITE_AIID_API || '').replace(/\/$/, '')

// --- mock raw leaves (pre-prior visual probabilities) ---------------------
// Real taxa present in region_checklist so the prior visibly re-ranks.
const MOCK_LEAVES = [
  ['Mechanitis messenoides messenoides', 0.27],
  ['Melinaea menophilus zaneka', 0.17],
  ['Ithomia salapia aquinia', 0.13],      // Peru-only -> Ecuador prior demotes it
  ['Oleria onega janarilla', 0.11],
  ['Heliconius erato favorinus', 0.09],   // Peru-only -> Ecuador prior demotes it
  ['Hypothyris euclea', 0.08],
  ['Napeogenes inachia', 0.06],
  ['Melinaea marsaeus mothone', 0.05],
  ['Mechanitis polymnia', 0.04],
]

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < (s || '').length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) / 4294967295
}

function mockRawLeaves(filename) {
  const seed = hash(filename || 'demo')
  const off = Math.floor(seed * MOCK_LEAVES.length)
  // rotate order by filename so different photos give different (stable) results
  const rotated = MOCK_LEAVES.map((_, i) => MOCK_LEAVES[(i + off) % MOCK_LEAVES.length])
  const raw = rotated.map(([name], i) => [name, Math.exp(-(i + seed) * 0.55)])
  const s = raw.reduce((a, b) => a + b[1], 0)
  return raw.map(([name, p]) => [name, p / s])
}

// Fetch RAW leaves for prepared image items. Returns
//   [{ id, filename, leaves: [[taxon, prob], ...], mock }]
export async function predictRaw(files) {
  if (!API_BASE) {
    return files.map((f, i) => ({
      id: f.id || `img_${i}`, filename: f.name, leaves: mockRawLeaves(f.name), mock: true,
    }))
  }
  const form = new FormData()
  for (const f of files) form.append('images', f.blob || f.file || f, f.name)
  const res = await fetch(`${API_BASE}/predict_raw`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Backend ${res.status}`)
  const json = await res.json()
  return json.results.map((r, i) => ({
    id: files[i]?.id || `img_${i}`, filename: r.filename, leaves: r.leaves, mock: !!json.mock,
  }))
}

const genusOf = (t) => t.split(/\s+/)[0]
const speciesOf = (t) => t.split(/\s+/).slice(0, 2).join(' ')
const isSubsp = (t) => t.split(/\s+/).length >= 3
const round = (x) => Math.round(x * 1e4) / 1e4

// Pure re-rank: apply the geographic prior to raw leaves, renormalise, then
// marginalise into the { genus, species, subspecies, species_all, side } shape
// PredictionPanel uses. No I/O — safe to call on every country/side change.
export function rankLeaves(rawLeaves, checklist, { country = '', side = '', eps = DEFAULT_EPS } = {}) {
  // 1. weight + renormalise
  const weighted = rawLeaves.map(([name, p]) => {
    const w = geoWeight(entryFor(checklist, name), country, side, eps)
    return { name, p: p * w }
  })
  const sum = weighted.reduce((a, b) => a + b.p, 0) || 1
  weighted.forEach((l) => (l.p = l.p / sum))

  const oorOf = (taxon) => isOffRegion(checklist, taxon, country, side, eps)

  // 2. marginalise
  const spMap = new Map(), geMap = new Map()
  const subs = []
  for (const { name, p } of weighted) {
    const sp = speciesOf(name), ge = genusOf(name)
    spMap.set(sp, (spMap.get(sp) || 0) + p)
    geMap.set(ge, (geMap.get(ge) || 0) + p)
    if (isSubsp(name)) subs.push([name, round(p), oorOf(name) ? 1 : 0])
  }

  const subspBySpecies = new Map()
  for (const s of subs) {
    const sp = speciesOf(s[0])
    if (!subspBySpecies.has(sp)) subspBySpecies.set(sp, [])
    subspBySpecies.get(sp).push(s)
  }
  for (const arr of subspBySpecies.values()) arr.sort((a, b) => b[1] - a[1])

  const species = [...spMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, p]) => [name, round(p), oorOf(name) ? 1 : 0, subspBySpecies.get(name) || []])
  const genus = [...geMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, p]) => [name, round(p), oorOf(name) ? 1 : 0])

  return {
    genus: genus.slice(0, 8),
    species: species.slice(0, 8),
    species_all: species.map((s) => [s[0], s[1], s[2]]),
    subspecies: subs.sort((a, b) => b[1] - a[1]).slice(0, 8),
    side: side || '',
    n_views: 1,
  }
}
