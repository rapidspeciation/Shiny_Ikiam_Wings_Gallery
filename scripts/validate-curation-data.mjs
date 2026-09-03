import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'public', 'data')
const read = name => JSON.parse(readFileSync(resolve(root, name), 'utf8'))
const fail = message => { throw new Error(message) }

const metadata = read('curation_sources.json')
if (metadata.schema_version !== 2) fail('curation_sources.json schema_version must be 2')
if (metadata.defaults?.boxes !== 'v6' || metadata.defaults?.predictions !== 'candidate_d') fail('candidate-D and Wings-v6 must be the defaults')
if (metadata.predictions?.candidate_d?.display_seed !== 1701 || !metadata.predictions?.candidate_d?.checkpoint_sha256) fail('candidate-D seed/checkpoint provenance is required')
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

function validatePredictions(file, strict = false) {
  const data = read(file)
  for (const [camid, pred] of Object.entries(data)) {
    if (!/^CAM/i.test(camid)) fail(`${file}: invalid CAMID ${camid}`)
    if (strict && pred.source !== 'candidate_d') fail(`${file}: ${camid} is not candidate-D`)
    for (const rank of ['family', 'subfamily', 'tribe', 'genus', 'species', 'subspecies']) {
      const row = pred.rank_predictions?.[rank]
      if (strict && row && (!row.prediction || !Number.isFinite(row.confidence))) fail(`${file}: ${camid}.${rank} invalid rank_predictions row`)
      if (strict && row && row.top5_labels_available !== false) fail(`${file}: ${camid}.${rank} must declare unavailable top-five labels`)
      if (pred[rank] != null && !Array.isArray(pred[rank])) fail(`${file}: ${camid}.${rank} must be an array`)
      for (const [index, legacyRow] of (pred[rank] || []).entries()) {
        if (!Array.isArray(legacyRow) || typeof legacyRow[0] !== 'string' || !Number.isFinite(legacyRow[1])) fail(`${file}: ${camid}.${rank}[${index}] invalid`)
        if (strict && (!Number.isFinite(legacyRow[2]) || ![0, 1].includes(legacyRow[2]))) fail(`${file}: ${camid}.${rank}[${index}] needs numeric oor`)
        if (strict && rank === 'species' && !Array.isArray(legacyRow[3])) fail(`${file}: ${camid}.species[${index}] needs nested subspecies`)
      }
    }
    if (strict && pred.recorded_taxonomy?.raw == null) fail(`${file}: ${camid} missing recorded taxonomy separation`)
  }
  return Object.keys(data).length
}

const collection = read('collection.json')
const resolveCamid = item => {
  const explicit = String(item?.CAM_ID || '').trim().match(/^(CAM\d+)/i)
  if (explicit) return explicit[1].toUpperCase()
  const names = (item?.all_photos || []).map(row => row?.Name)
  names.push(item?.Photo_dorsal, item?.Photo_ventral)
  for (const name of names) {
    const match = String(name || '').match(/^(CAM\d+)/i)
    if (match) return match[1].toUpperCase()
  }
  return null
}
const reachableCamids = new Set(collection.map(resolveCamid).filter(Boolean))
const candidate = read('predictions.json')
const legacy = read('predictions_legacy.json')
if (Object.keys(candidate).length !== 3022) fail(`predictions.json expected 3022 candidate-D CAMIDs, got ${Object.keys(candidate).length}`)
const reachableCandidate = Object.keys(candidate).filter(camid => reachableCamids.has(camid)).length
if (reachableCandidate === 0) fail('no candidate-D predictions resolve to collection CAMIDs')
const missing = read('prediction_missing_reasons.json')
const historicalWithoutCandidate = Object.keys(legacy).filter(camid => !candidate[camid])
if (historicalWithoutCandidate.length !== 1801) fail(`expected 1801 historical CAMIDs without candidate-D, got ${historicalWithoutCandidate.length}`)
for (const camid of Object.keys(legacy)) if (!missing[camid]) fail(`missing-reasons does not cover historical CAMID ${camid}`)
for (const camid of historicalWithoutCandidate) if (!missing[camid].reason) fail(`historical missing reason absent for ${camid}`)
for (const [camid, pred] of Object.entries(candidate)) {
  const absentRanks = ['family', 'subfamily', 'tribe', 'genus', 'species', 'subspecies'].filter(rank => !pred.rank_predictions?.[rank])
  if (absentRanks.length && !missing[camid]?.reason) fail(`candidate rank-missing reason absent for ${camid}`)
}

const boxes = read('wing_boxes_v6.json')
const boxReasons = read('wing_box_reasons.json')
for (const camid of ['CAM070488', 'CAM070494', 'CAM070495', 'CAM070796']) {
  if (!candidate[camid]) fail(`predictions.json missing required control ${camid}`)
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
  candidate_predictions: validatePredictions('predictions.json', true),
  legacy_predictions: validatePredictions('predictions_legacy.json'),
  candidate_reachable_collection: reachableCandidate,
  candidate_unreachable_tabs_or_other: Object.keys(candidate).length - reachableCandidate,
  historical_without_candidate: historicalWithoutCandidate.length,
  missing_reason_rows: Object.keys(missing).length,
  box_reason_rows: Object.keys(boxReasons).length
}
console.log(JSON.stringify({ status: 'ok', counts }))
