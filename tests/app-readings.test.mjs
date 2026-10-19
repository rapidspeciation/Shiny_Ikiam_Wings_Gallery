import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkReadings, fetchReadings, READINGS } from '../scripts/fetch-app-readings.mjs'
import { driveFileId, pickBoxes, photoOutlines, unionBox, unionBoxScale } from '../src/utils/wingBoxes.js'
import { VIEW_DEFAULTS, readView } from '../src/utils/shareView.js'

const PATH = 'M100 120 180 110 260 150 240 300 120 280Z'
const files = {
  'predictions_app.json': {
    CAM036744: {
      species: [['Callithomia hezia', 0.3824], ['Mechanitis lysimnia', 0.1993]],
      subspecies: [['Callithomia hezia beronilla', 0.3815]], genus: [['Callithomia', 0.3839]],
      side: '', n_views: 2, mode: 'app_readings', model_meta: { source: 'photo_readings_20261018' }
    }
  },
  'sex_predictions_app.json': {
    CAM036744: { sex: 'male', confidence: 0.93, male_probability: 0.93, supported: true, species: 'Callithomia hezia', screen_status: 'species_supported' }
  },
  'wing_boxes_app.json': {
    CAM036744v: [{ box: [0.1031, 0.1621, 0.6512, 0.6204], conf: 0.961, model: 'v5n', union: true, file: 'F1' }]
  },
  'wing_outlines.json': {
    version: 1, source: 'test', photos: { CAM036744v: { file: 'F1', w: [['fw', 'l', PATH], ['hw', 'r', PATH], ['x', 'u', PATH]] } }
  }
}

test('each readings file in the agreed format passes as is', () => {
  for (const [name, doc] of Object.entries(files)) {
    const checked = checkReadings(name, doc)
    assert.equal(checked.error, undefined, name)
    assert.equal(checked.dropped, 0, name)
    assert.deepEqual(checked.doc, doc, name)
  }
})

test('invalid rows are left out and a file without valid rows is refused', () => {
  const boxes = { ...files['wing_boxes_app.json'], CAM1d: [{ box: [0.6, 0.1, 0.2, 0.5] }], 'not a photo': [{ box: [0, 0, 1, 1] }] }
  assert.deepEqual(checkReadings('wing_boxes_app.json', boxes), { doc: files['wing_boxes_app.json'], kept: 1, dropped: 2 })
  const outlines = { photos: { CAM1d: { w: [['fw', 'l', 'M1 2 3 4 5 6Z" onload="x']] }, CAM2d: { w: [['fw', 'l', 'M1 2 1200 4 5 6Z']] } } }
  assert.match(checkReadings('wing_outlines.json', outlines).error, /no valid rows/)
  assert.match(checkReadings('sex_predictions_app.json', { CAM1: { sex: 'unknown', confidence: 2 } }).error, /no valid rows/)
  assert.match(checkReadings('predictions_app.json', []).error, /not a JSON object/)
})

function server(routes) {
  return async url => {
    const name = url.split('/').pop()
    const route = routes[name]
    if (route instanceof Error) throw route
    if (route === undefined) return { ok: false, status: 404, text: async () => 'Not found' }
    return { ok: true, status: 200, text: async () => (typeof route === 'string' ? route : JSON.stringify(route)) }
  }
}

test('downloaded readings replace the copies in public/data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'readings-'))
  const results = await fetchReadings({ outDir: dir, fetchFn: server(files), log: () => {} })
  for (const name of Object.keys(READINGS)) {
    assert.equal(results[name].updated, true, name)
    assert.deepEqual(JSON.parse(readFileSync(join(dir, name), 'utf8')), files[name])
  }
})

test('an unreachable, missing, broken or much smaller file keeps the current copy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'readings-'))
  const many = Object.fromEntries(['CAM000001', 'CAM000002', 'CAM000003'].map(k => [k, files['predictions_app.json'].CAM036744]))
  writeFileSync(join(dir, 'predictions_app.json'), JSON.stringify(many))
  writeFileSync(join(dir, 'sex_predictions_app.json'), JSON.stringify(files['sex_predictions_app.json']))
  writeFileSync(join(dir, 'wing_boxes_app.json'), JSON.stringify(files['wing_boxes_app.json']))
  const results = await fetchReadings({
    outDir: dir, log: () => {},
    fetchFn: server({
      'predictions_app.json': files['predictions_app.json'],   // 1 row where there were 3
      'sex_predictions_app.json': new TypeError('fetch failed'),
      'wing_boxes_app.json': '<!doctype html>'
      // wing_outlines.json: 404
    })
  })
  assert.deepEqual(Object.values(results).map(r => r.updated), [false, false, false, false])
  assert.match(results['predictions_app.json'].reason, /1 rows, the current copy has 3/)
  assert.match(results['sex_predictions_app.json'].reason, /unreachable/)
  assert.equal(results['wing_boxes_app.json'].reason, 'not JSON')
  assert.equal(results['wing_outlines.json'].reason, 'HTTP 404')
  assert.equal(Object.keys(JSON.parse(readFileSync(join(dir, 'predictions_app.json'), 'utf8'))).length, 3)
  assert.equal(existsSync(join(dir, 'wing_outlines.json')), false)
})

test('the readings box wins over Wings-v6 unless the photo was replaced since', () => {
  const layer = files['wing_boxes_app.json']
  const v6 = { CAM036744v: [{ box: [0.06, 0.13, 0.68, 0.64], union: true }], CAM1d: [{ box: [0.1, 0.1, 0.9, 0.9] }] }
  assert.equal(pickBoxes(layer, v6, 'CAM036744v', 'F1'), layer.CAM036744v)
  assert.equal(pickBoxes(layer, v6, 'CAM036744v'), layer.CAM036744v)
  assert.equal(pickBoxes(layer, v6, 'CAM036744v', 'F2'), v6.CAM036744v)
  assert.equal(pickBoxes(layer, v6, 'CAM1d', 'F9'), v6.CAM1d)
  assert.deepEqual(pickBoxes({}, {}, 'CAM2d'), [])
  assert.equal(driveFileId('https://drive.google.com/uc?id=1sS8Z6Ec6VI2UNQkXNWOV3XpQvY7KpEtb'), '1sS8Z6Ec6VI2UNQkXNWOV3XpQvY7KpEtb')
  assert.equal(driveFileId('https://drive.google.com/file/d/abc_D-1/view?usp=sharing'), 'abc_D-1')
})

test('zoom to wings frames the padded box as is', () => {
  const u = unionBox(files['wing_boxes_app.json'].CAM036744v, { padding: 0, aspect: null })
  assert.deepEqual(u, { x1: 0.1031, y1: 0.1621, x2: 0.6512, y2: 0.6204 })
  assert.equal(unionBoxScale(u, 8, 1), 1 / (0.6512 - 0.1031))
})

test('outlines: wings only, never a replaced file; the switch is part of a shared view', () => {
  const photos = files['wing_outlines.json'].photos
  assert.deepEqual(photoOutlines(photos, 'CAM036744v', 'F1').map(w => w.kind), ['fw', 'hw'])
  assert.equal(photoOutlines(photos, 'CAM036744v', 'F1')[0].d, PATH)
  assert.deepEqual(photoOutlines(photos, 'CAM036744v', 'F2'), [])
  assert.deepEqual(photoOutlines(null, 'CAM036744v'), [])
  assert.equal(VIEW_DEFAULTS.showOutlines, false)
  assert.equal(readView('?showOutlines=1', VIEW_DEFAULTS).showOutlines, true)
})
