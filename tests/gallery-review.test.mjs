import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  canonicalTaxon,
  predictionDiffers,
  rankComparison
} from '../src/utils/taxonomy.js'
import { modelConfidence, sortItems } from '../src/utils/galleryPipeline.js'
import { unionBox, unionBoxScale } from '../src/utils/wingBoxes.js'

const dataRoot = resolve('public/data')
const read = name => JSON.parse(readFileSync(resolve(dataRoot, name), 'utf8'))
const candidate = read('predictions.json')
const legacy = read('predictions_legacy.json')
const missing = read('prediction_missing_reasons.json')
const boxReasons = read('wing_box_reasons.json')
const boxes = read('wing_boxes_v6.json')

const record = (species, subspecies = '') => ({
  Genus: species?.split(/\s+/)[0] || '',
  Species: species,
  Subspecies_Form: subspecies
})

const candidateRow = (label, confidence = 0.7, top5 = true) => ({
  prediction: label,
  confidence,
  top5_correct: top5,
  top5_available: true,
  top5_labels_available: false
})

test('candidate-D replaces the default prediction payload without historical fallback', () => {
  assert.equal(Object.keys(candidate).length, 3022)
  assert.equal(Object.keys(legacy).length, 4823)
  const first = candidate.CAM042391
  assert.equal(first.source, 'candidate_d')
  assert.equal(first.seed, 1701)
  assert.equal(first.cell, 'D_padded_guides_support1')
  assert.equal(first.model_meta.display_seed_rule.includes('no test-set seed shopping'), true)
  assert.equal(first.rank_predictions.species.top5_available, true)
  assert.equal(first.rank_predictions.species.top5_labels_available, true)
  assert.equal(first.rank_predictions.species.top5_labels.length, 5)
})

test('canonical synonyms apply before comparison and display', () => {
  assert.equal(canonicalTaxon('Vanessa brasiliensis'), 'Vanessa braziliensis')
  assert.equal(canonicalTaxon('Oleria onega jaranilla'), 'Oleria onega janarilla')
  const vanessa = {
    recorded_taxonomy: {
      raw: { species: 'Vanessa brasiliensis' },
      canonical: { species: 'Vanessa braziliensis' }
    },
    rank_predictions: { species: candidateRow('Vanessa braziliensis') }
  }
  const comparison = rankComparison(record('Vanessa brasiliensis'), vanessa, 'species')
  assert.equal(comparison.status, 'synonym-only')
  assert.equal(predictionDiffers(record('Vanessa brasiliensis'), vanessa, 'species'), false)
  const bareSubspecies = {
    recorded_taxonomy: {
      raw: { species: 'Oleria onega', subspecies: 'jaranilla' },
      canonical: { species: 'Oleria onega', subspecies: 'Oleria onega jaranilla' }
    },
    rank_predictions: { subspecies: candidateRow('Oleria onega janarilla') }
  }
  assert.equal(rankComparison(record('Oleria onega', 'jaranilla'), bareSubspecies, 'subspecies').status, 'synonym-only')
})

test('rank-aware disagreement and missing states are explicit', () => {
  const pred = {
    recorded_taxonomy: { canonical: { species: 'Morpho helenor' }, raw: { species: 'Morpho helenor' } },
    rank_predictions: {
      genus: candidateRow('Morpho'),
      species: candidateRow('Morpho aega', 0.91),
      subspecies: candidateRow('Morpho helenor theodorus', 0.2)
    }
  }
  assert.equal(rankComparison(record('Morpho helenor'), pred, 'species').status, 'disagreement')
  assert.equal(predictionDiffers(record('Morpho helenor'), pred, 'species'), true)
  assert.equal(rankComparison(record('Morpho helenor'), pred, 'genus').status, 'agreement')
  assert.equal(rankComparison(record('Morpho helenor'), null, 'species').status, 'missing')
})

test('authoritative collection taxonomy fixes CAM077706 and prevents false disagreement', () => {
  const cam = candidate.CAM077706
  assert.equal(cam.recorded_taxonomy.canonical.subspecies, 'Hypothyris euclea intermedia')
  assert.equal(cam.rank_predictions.subspecies.prediction, 'Hypothyris euclea intermedia')
  const item = { Genus: 'Hypothyris', Species: 'Hypothyris euclea', Subspecies_Form: 'intermedia' }
  assert.equal(predictionDiffers(item, cam, 'subspecies'), false)
  assert.equal(cam.recorded_taxonomy.canonical.genus, 'Hypothyris')
})

test('CAMID collision ledger is scoped, authoritative, and fold-independent', () => {
  const ledger = read('camid-collision-ledger.json')
  assert.equal(ledger.raw_duplicate_groups, 7)
  assert.equal(ledger.resolved_duplicate_groups, 6)
  assert.equal(ledger.apparent_taxonomy_conflicts, 4)
  assert.deepEqual(ledger.explicit_vs_photo_conflicts, ['CAM077706', 'CAM077707', 'CAM077708'])
  const cam = ledger.entries.find(entry => entry.camid === 'CAM077706')
  assert.equal(cam.records.find(row => row.identity === 'explicit').taxonomy.subspecies, 'Hypothyris euclea intermedia')
})

test('model confidence sorting uses selected candidate rank and missing rows sort last descending', () => {
  const items = [{ CAM_ID: 'CAM-A' }, { CAM_ID: 'CAM-B' }, { CAM_ID: 'CAM-C' }]
  const map = {
    'CAM-A': { rank_predictions: { species: candidateRow('A', 0.2) } },
    'CAM-B': { rank_predictions: { species: candidateRow('B', 0.95) } }
  }
  assert.equal(modelConfidence(items[1], map), 0.95)
  assert.deepEqual(sortItems(items, 'ModelConfidence', 'desc', map).map(item => item.CAM_ID), ['CAM-B', 'CAM-A', 'CAM-C'])
  assert.deepEqual(sortItems(items, 'ModelConfidence', 'asc', map).map(item => item.CAM_ID), ['CAM-C', 'CAM-A', 'CAM-B'])
})

test('top-five contract exposes verified fold-local ranked labels and probabilities', () => {
  const row = candidate.CAM042391.rank_predictions.species
  assert.equal(row.top5_available, true)
  assert.equal(row.top5_labels_available, true)
  assert.equal(row.top5_labels.length, 5)
  assert.equal(row.top5_probabilities.length, 5)
  assert.ok(row.top5_probabilities.every((value, index, values) => index === 0 || value <= values[index - 1]))
  assert.equal(readFileSync('public/data/candidate_d_receipt.json', 'utf8').includes('top5_labels_available'), true)
})

test('ranked replay preserves recorded probability outside top five and nested species tree', () => {
  const cam = candidate.CAM074313
  assert.equal(cam.rank_predictions.species.prediction, 'Zaretis isidora')
  assert.equal(cam.rank_predictions.species.top5_labels.length, 5)
  assert.equal(cam.rec.species_p, 0.0005931223240908262)
  assert.equal(cam.species[0][0], 'Zaretis isidora')
  assert.ok(Array.isArray(cam.species[0][3]))
})

test('missing reason ledger covers historical rows and frozen zero-detection full-image rows', () => {
  const historicalWithoutCandidate = Object.keys(legacy).filter(camid => !candidate[camid])
  assert.equal(historicalWithoutCandidate.length, 1801)
  for (const camid of Object.keys(legacy)) assert.ok(missing[camid], `missing reason for ${camid}`)
  for (const camid of historicalWithoutCandidate) assert.ok(missing[camid].reason)
  const rankMissingCamid = Object.keys(candidate).find(camid => Object.keys(candidate[camid].rank_predictions).length < 6)
  assert.ok(rankMissingCamid && missing[rankMissingCamid].reason)
  for (const key of ['cam070267d', 'cam075743v3']) {
    assert.equal(boxReasons[key].status, 'zero_detection')
    assert.equal(boxReasons[key].uses_full_image, true)
    assert.match(boxReasons[key].reason, /full image retained/)
  }
})

test('Zoom to wings uses tight union coordinates with aspect and clamp', () => {
  const box = unionBox([
    { box: [0.2, 0.3, 0.4, 0.6] },
    { box: [0.6, 0.1, 0.9, 0.4] },
    { box: [-1, 0, 0.2, 0.2] },
    { box: [0.4, 0.4, 0.4, 0.5] }
  ], { padding: 0, aspect: 1.15 })
  assert.ok(box)
  assert.ok(box.x1 >= 0 && box.y1 >= 0 && box.x2 <= 1 && box.y2 <= 1)
  assert.equal(box.x1, 0.2)
  assert.equal(box.x2, 0.9)
  assert.ok(unionBox([]) === null)
  assert.ok(unionBoxScale(box) > 1)
  for (const key of ['CAM070697d', 'CAM074338v', 'CAM072949d', 'CAM075867v1']) {
    assert.ok(boxes[key]?.length, `missing representative union ${key}`)
    assert.ok(boxes[key].every(row => row.union === true), `${key} is not marked union`)
  }
})

test('upstream review surface retains prediction controls and wing-box behavior', () => {
  const collection = readFileSync('src/components/CollectionTab.vue', 'utf8')
  const panel = readFileSync('src/components/PredictionPanel.vue', 'utf8')
  const photo = readFileSync('src/components/PhotoCard.vue', 'utf8')
  assert.match(photo, /unionBox\(st\.boxes, \{ padding: 0, aspect: 1\.15 \}\)/)
  for (const token of ['Model vs recorded', 'Show Photos']) assert.match(collection, new RegExp(token))
  for (const token of ['Model predictions', 'pred-tree']) assert.match(panel, new RegExp(token))
  assert.doesNotMatch(collection, /Candidate D audit|Open disagreements/)
  assert.doesNotMatch(panel, /membership only|Model rank review/)
  assert.match(photo, /getBoxReason/)
  assert.match(panel, /max-width: 576px/)
})
