import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { hasAnyPhoto, resolveCamid } from '../src/utils/galleryPipeline.js'
import { mergeCurrentPredictionMaps } from '../src/utils/predictionCoverage.js'

const root = resolve(import.meta.dirname, '..', 'public', 'data')
const read = name => JSON.parse(readFileSync(resolve(root, name), 'utf8'))
const readOptional = name => existsSync(resolve(root, name)) ? read(name) : null
const fail = message => { throw new Error(message) }
const assertExact = (actual, expected, message) => {
  if (actual !== expected) fail(`${message}: expected ${expected}, got ${actual}`)
}

const ACTIVE_MODEL = {
  checkpoint: '34ecd53f64b3f9dc600710af5ca8df7cd94845653a9ce9f916dcd08adc520167',
  expandedRelease: 'expanded-taxonomy-preview-20260910',
  coverageRelease: 'taxonomy-coverage-20260911'
}
const PRODUCTION_HEAD = {
  checkpoint: 'e461eb4eda24c179b9ae450c86ee38547aa89b689627bcd5ba5551d0f1d2e1f1',
  release: 'boa-production-20260907'
}
const LIVE_REVISION = '00dfafe652dbd023846e31ae1ded2b3191f88bc8'

const metadata = read('curation_sources.json')
if (metadata.schema_version !== 2) fail('curation_sources.json schema_version must be 2')
if (metadata.defaults?.boxes !== 'v6' || metadata.defaults?.predictions !== 'candidate_d') fail('candidate-D and Wings-v6 must be the defaults')
if (metadata.predictions?.candidate_d?.checkpoint_sha256 !== ACTIVE_MODEL.checkpoint) fail('current prediction checkpoint provenance is incorrect')
if (metadata.predictions?.candidate_d?.file !== 'predictions_expanded_concat_dv.json') fail('current prediction metadata must name the expanded asset')
if (JSON.stringify(metadata.predictions?.candidate_d?.supplemental_files) !== JSON.stringify(['predictions_coverage_current.json', 'predictions_live_real.json'])) fail('current prediction metadata must name the ordered supplemental assets')
for (const [kind, expected] of [['boxes', ['v6', 'legacy']], ['predictions', ['candidate_d', 'legacy']]]) {
  if (!metadata[kind]) fail(`metadata.${kind} missing`)
  for (const source of expected) {
    const entry = metadata[kind][source]
    if (!entry?.label || !entry?.build_id) fail(`metadata.${kind}.${source} requires label and build_id`)
  }
}

function validateBoxes(file) {
  const data = read(file)
  for (const [key, boxes] of Object.entries(data)) {
    if (!/^CAM\S+$/i.test(key)) fail(`${file}: invalid photo key ${key}`)
    if (!Array.isArray(boxes)) fail(`${file}: ${key} must contain an array`)
    for (const [index, row] of boxes.entries()) {
      if (!Array.isArray(row?.box) || row.box.length !== 4) fail(`${file}: ${key}[${index}] needs box[4]`)
      if (!row.box.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) fail(`${file}: ${key}[${index}] box must be normalized`)
      const [x1, y1, x2, y2] = row.box
      if (x1 >= x2 || y1 >= y2) fail(`${file}: ${key}[${index}] box has non-positive area`)
      if (row.conf != null && (!Number.isFinite(row.conf) || row.conf < 0 || row.conf > 1)) fail(`${file}: ${key}[${index}] invalid conf`)
    }
  }
  return Object.keys(data).length
}

function validatePredictions(file, data, { ranks, requireOor = false, requireRec = false } = {}) {
  for (const [camid, pred] of Object.entries(data)) {
    if (!/^CAM/i.test(camid)) fail(`${file}: invalid CAMID ${camid}`)
    if (!pred.model_meta || typeof pred.model_meta !== 'object') fail(`${file}: ${camid} missing model_meta`)
    if (!Number.isInteger(pred.n_views) || pred.n_views < 1) fail(`${file}: ${camid} invalid n_views`)
    for (const rank of ranks) {
      if (!Array.isArray(pred[rank]) || pred[rank].length === 0) fail(`${file}: ${camid}.${rank} must be a non-empty array`)
      for (const [index, row] of pred[rank].entries()) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0] || !Number.isFinite(row[1]) || row[1] < 0 || row[1] > 1) fail(`${file}: ${camid}.${rank}[${index}] invalid`)
        if (requireOor && (!Number.isFinite(row[2]) || ![0, 1].includes(row[2]))) fail(`${file}: ${camid}.${rank}[${index}] needs numeric oor`)
        if (rank === 'species' && requireOor && !Array.isArray(row[3])) fail(`${file}: ${camid}.species[${index}] needs nested subspecies`)
      }
    }
    if (requireRec && (!pred.rec || typeof pred.rec !== 'object')) fail(`${file}: ${camid} missing recorded taxonomy context`)
  }
  return Object.keys(data).length
}

function validateLegacyPredictions(file, data) {
  for (const [camid, pred] of Object.entries(data)) {
    if (!/^CAM/i.test(camid)) fail(`${file}: invalid CAMID ${camid}`)
    if (!Number.isInteger(pred.n_views) || pred.n_views < 1) fail(`${file}: ${camid} invalid n_views`)
    for (const rank of ['genus', 'species', 'subspecies']) {
      if (!Array.isArray(pred[rank])) fail(`${file}: ${camid}.${rank} must be an array`)
      for (const [index, row] of pred[rank].entries()) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || !Number.isFinite(row[1])) fail(`${file}: ${camid}.${rank}[${index}] invalid`)
      }
    }
  }
  return Object.keys(data).length
}

const collection = read('collection.json')
const reachableCamids = new Set(collection.map(resolveCamid).filter(Boolean))
const visibleCamids = new Set(collection.filter(hasAnyPhoto).map(resolveCamid).filter(Boolean))
const expanded = read('predictions_expanded_concat_dv.json')
const coverage = readOptional('predictions_coverage_current.json')
const live = read('predictions_live_real.json')
const legacy = read('predictions_legacy.json')

assertExact(Object.keys(expanded).length, 3849, 'expanded prediction count')
assertExact(Object.keys(live).length, 269, 'live prediction count')
for (const [camid, pred] of Object.entries(expanded)) {
  const meta = pred.model_meta
  const paired = meta?.pairing_policy === 'EXPANDED_PAIRED'
  const validIdentity = paired
    ? meta.release === ACTIVE_MODEL.expandedRelease && meta.checkpoint_sha256 === ACTIVE_MODEL.checkpoint
    : meta?.release === PRODUCTION_HEAD.release && meta?.checkpoint_sha256 === PRODUCTION_HEAD.checkpoint
  if (!validIdentity) fail(`predictions_expanded_concat_dv.json: ${camid} has unexpected model identity`)
  if (![0, false].includes(pred.oof) || meta.oof !== false) fail(`predictions_expanded_concat_dv.json: ${camid} must be a final-fit prediction`)
}
assertExact(Object.values(expanded).filter(pred => pred.model_meta.pairing_policy === 'EXPANDED_PAIRED').length, 3829, 'expanded paired prediction count')
for (const [camid, pred] of Object.entries(live)) {
  const meta = pred.model_meta
  if (pred.mode !== 'live_real' || meta.source !== 'hf-space-predict_raw' || meta.mock !== false || meta.deployed_revision !== LIVE_REVISION) fail(`predictions_live_real.json: ${camid} has unexpected deployed model identity`)
}

const priorActive = mergeCurrentPredictionMaps({ expanded, live })
assertExact(Object.keys(priorActive).length, 4118, 'expanded and live union count')
const missingVisibleBeforeCoverage = [...visibleCamids].filter(camid => !priorActive[camid])
assertExact(visibleCamids.size, 4388, 'photo-present collection CAMID count')
assertExact(missingVisibleBeforeCoverage.length, 402, 'photo-present CAMIDs requiring coverage')

if (coverage) {
  assertExact(Object.keys(coverage).length, 402, 'coverage prediction count')
  const expectedCoverage = new Set(missingVisibleBeforeCoverage)
  for (const [camid, pred] of Object.entries(coverage)) {
    if (!expectedCoverage.has(camid)) fail(`predictions_coverage_current.json: unexpected or overlapping CAMID ${camid}`)
    if (Object.hasOwn(pred, 'rec') || Object.hasOwn(pred, 'recorded_taxonomy')) fail(`predictions_coverage_current.json: ${camid} must not embed recorded taxonomy`)
    const meta = pred.model_meta
    if (meta?.release !== ACTIVE_MODEL.coverageRelease || meta?.checkpoint_sha256 !== ACTIVE_MODEL.checkpoint || meta?.oof !== false || ![0, false].includes(pred.oof)) fail(`predictions_coverage_current.json: ${camid} has unexpected model identity`)
  }
}

const active = mergeCurrentPredictionMaps({ expanded, coverage: coverage || {}, live })
assertExact(Object.keys(active).length, coverage ? 4520 : 4118, 'active prediction union count')
const missingVisible = [...visibleCamids].filter(camid => !active[camid])
assertExact(missingVisible.length, coverage ? 0 : 402, 'photo-present CAMIDs missing active predictions')
const reachableActive = Object.keys(active).filter(camid => reachableCamids.has(camid)).length
if (reachableActive === 0) fail('no active predictions resolve to collection CAMIDs')

const missing = read('prediction_missing_reasons.json')
const historicalWithoutActive = Object.keys(legacy).filter(camid => !active[camid])
assertExact(historicalWithoutActive.length, coverage ? 572 : 974, 'legacy CAMIDs without active predictions')
for (const camid of historicalWithoutActive) if (!missing[camid]?.reason) fail(`historical missing reason absent for ${camid}`)
if (coverage) for (const camid of Object.keys(coverage)) {
  if (missing[camid]?.reason) fail(`obsolete missing prediction reason remains for covered CAMID ${camid}`)
}

const boxes = read('wing_boxes_v6.json')
const boxReasons = read('wing_box_reasons.json')
for (const camid of ['CAM070488', 'CAM070494', 'CAM070495', 'CAM070796']) {
  if (!active[camid]) fail(`active predictions missing required control ${camid}`)
  for (const view of ['d', 'v']) if (!Object.keys(boxes).some(key => key.toLowerCase() === `${camid}${view}`.toLowerCase())) fail(`wing_boxes_v6.json missing ${camid}${view}`)
}
for (const [key, label] of [['CAM070697d', 'four-wing control'], ['CAM070697v', 'four-wing control'], ['CAM074338v', 'three-wing control'], ['CAM072949d', 'two-wing control'], ['CAM075867v1', 'one-wing control']]) {
  const row = boxes[key]
  if (!row?.length || !row.every(box => box.union === true)) fail(`${label} ${key} must use a frozen union box`)
}
for (const key of ['cam070267d', 'cam075743v3']) {
  if (boxReasons[key]?.status !== 'zero_detection' || !boxReasons[key].uses_full_image || !boxReasons[key].reason) fail(`zero-detection full-image reason missing for ${key}`)
}

const counts = {
  legacy_box_photos: validateBoxes('wing_boxes.json'),
  v6_box_photos: validateBoxes('wing_boxes_v6.json'),
  expanded_predictions: validatePredictions('predictions_expanded_concat_dv.json', expanded, { ranks: ['family', 'subfamily', 'tribe', 'genus', 'species', 'subspecies'], requireOor: true, requireRec: true }),
  coverage_predictions: coverage ? validatePredictions('predictions_coverage_current.json', coverage, { ranks: ['family', 'subfamily', 'tribe', 'genus', 'species', 'subspecies'], requireOor: true }) : 0,
  live_predictions: validatePredictions('predictions_live_real.json', live, { ranks: ['genus', 'species', 'subspecies'] }),
  active_predictions: Object.keys(active).length,
  legacy_predictions: validateLegacyPredictions('predictions_legacy.json', legacy),
  active_reachable_collection: reachableActive,
  active_unreachable_tabs_or_other: Object.keys(active).length - reachableActive,
  historical_without_active: historicalWithoutActive.length,
  visible_collection_without_active: missingVisible.length,
  missing_reason_rows: Object.keys(missing).length,
  box_reason_rows: Object.keys(boxReasons).length,
  coverage_sha256: coverage ? createHash('sha256').update(readFileSync(resolve(root, 'predictions_coverage_current.json'))).digest('hex') : null
}
console.log(JSON.stringify({ status: 'ok', counts }))
