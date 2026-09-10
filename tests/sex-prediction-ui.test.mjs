import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatSexPrediction, matchesSexFilter } from '../src/utils/sexPrediction.js'
import { sortItems } from '../src/utils/galleryPipeline.js'

test('sex predictions use the two-label support contract', () => {
  assert.equal(
    formatSexPrediction({ sex: 'female', confidence: 0.87, supported: true, species: 'Ithomia salapia' }, 'Ithomia salapia').text,
    'Predicted sex: Female · 87% · Supported'
  )
  assert.equal(
    formatSexPrediction({ sex: 'male', confidence: 0.99, supported: true, species: 'Hamadryas laodamia' }, 'Ithomia salapia').text,
    'Predicted sex: Male · 99% · Uncertain'
  )
  assert.equal(formatSexPrediction({ sex: 'male', confidence: 0.79, supported: true }, '').supported, false)
})

test('sex filters compare predictions with the recorded sex', () => {
  const item = { Sex: 'female' }
  assert.equal(matchesSexFilter(item, { sex: 'male', confidence: 0.9 }, 'Sex differs'), true)
  assert.equal(matchesSexFilter(item, { sex: 'female', confidence: 0.9 }, 'Sex matches'), true)
  assert.equal(matchesSexFilter(item, null, 'No sex prediction'), true)
  assert.equal(matchesSexFilter({ Sex: 'NA' }, { sex: 'female', confidence: 0.9 }, 'Sex matches'), false)
})

test('sex confidence sorting keeps Supported predictions above Uncertain predictions', () => {
  const items = [
    { CAM_ID: 'CAM-A', Species: 'Species alpha' },
    { CAM_ID: 'CAM-B', Species: 'Species beta' },
    { CAM_ID: 'CAM-C', Species: 'Species gamma' },
    { CAM_ID: 'CAM-D', Species: 'Species delta' }
  ]
  const predictions = {
    'CAM-A': { sex: 'female', confidence: 0.81, supported: true, species: 'Species alpha' },
    'CAM-B': { sex: 'male', confidence: 0.99, supported: false, species: 'Species beta' },
    'CAM-C': { sex: 'female', confidence: 0.95, supported: true, species: 'Species gamma' }
  }
  assert.deepEqual(
    sortItems(items, 'SexConfidence', 'desc', null, 'species', predictions).map(item => item.CAM_ID),
    ['CAM-C', 'CAM-A', 'CAM-B', 'CAM-D']
  )
  assert.deepEqual(
    sortItems(items, 'SexConfidence', 'asc', null, 'species', predictions).map(item => item.CAM_ID),
    ['CAM-A', 'CAM-C', 'CAM-B', 'CAM-D']
  )
})

test('AI Identifier direct predictions do not request collection sex predictions', () => {
  const panel = readFileSync('src/components/PredictionPanel.vue', 'utf8')
  assert.match(panel, /if \(!props\.prediction\) \{[\s\S]*getSexPrediction\(camid\.value\)/)
  assert.doesNotMatch(panel, /sexPrediction:\s*\{\s*type:/)
})
