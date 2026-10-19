// Downloads the Database Manager's public readings (species, sex, wing boxes, wing
// outlines) into public/data, for update_data.yml. Formats: docs in
// src/composables/useCurationData.js and the gallery-readings spec.
//
// A file that cannot be downloaded, does not parse, has no valid rows, or has
// less than half the rows of the copy already here keeps the copy already here:
// the script always ends with exit code 0, so the photo update still goes out.
//
//   node scripts/fetch-app-readings.mjs [outDir]
//   APP_READINGS_URL overrides the base URL.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const APP_READINGS_URL = 'https://ithomiini-ikiam.com/api/public/gallery'

const isProb = value => Number.isFinite(value) && value >= 0 && value <= 1
const isRankList = list => Array.isArray(list) && list.length > 0 &&
  list.every(row => Array.isArray(row) && typeof row[0] === 'string' && row[0].trim() && isProb(row[1]))
const camKey = key => /^(CAM\d{5,7}|M\d{4,5})$/i.test(key)
const photoKey = key => /^(CAM\d{5,7}|M\d{4,5})\S*$/i.test(key)
// version 1: absolute "M x y x y … Z"; version 2: relative "m x y l dx dy dx dy … z" (a minus sign may stand
// for the space before a number)
const OUTLINE_PATH = /^M\d{1,4}(?: \d{1,4}){5,}Z$/
const OUTLINE_PATH_REL = /^m\d{1,4} \d{1,4}l-?\d{1,4}(?:(?: |(?=-))-?\d{1,4}){3,}z$/

// The outline's points (flat, absolute 0..1000 grid), or null when the path is not one of the two forms.
export function outlinePoints(d) {
  if (typeof d !== 'string') return null
  if (OUTLINE_PATH.test(d)) return d.slice(1, -1).split(' ').map(Number)
  if (!OUTLINE_PATH_REL.test(d)) return null
  const [head, tail] = d.slice(1, -1).split('l')
  const flat = head.split(' ').map(Number)
  const steps = tail.match(/-?\d+/g).map(Number)
  if (steps.length % 2) return null
  for (const step of steps) flat.push(flat[flat.length - 2] + step)
  return flat
}

function validBox(row) {
  const box = row?.box
  return Array.isArray(box) && box.length === 4 && box.every(isProb) && box[0] < box[2] && box[1] < box[3] &&
    (row.conf === undefined || row.conf === null || isProb(row.conf))
}

function validOutline(wing) {
  return Array.isArray(wing) && ['fw', 'hw', 'x'].includes(wing[0]) && ['l', 'r', 'u'].includes(wing[1]) &&
    (outlinePoints(wing[2]) || [-1]).every(n => n >= 0 && n <= 1000)
}

// Each file: which rows are valid, and where the rows live in the document.
export const READINGS = {
  'predictions_app.json': {
    rows: doc => doc,
    valid: (key, row) => camKey(key) && row && isRankList(row.species) &&
      ['genus', 'subspecies'].every(rank => row[rank] === undefined || Array.isArray(row[rank]) && (!row[rank].length || isRankList(row[rank])))
  },
  'sex_predictions_app.json': {
    rows: doc => doc,
    valid: (key, row) => camKey(key) && row && ['male', 'female'].includes(row.sex) && isProb(row.confidence) &&
      typeof row.supported === 'boolean'
  },
  'wing_boxes_app.json': {
    rows: doc => doc,
    valid: (key, rows) => photoKey(key) && Array.isArray(rows) && rows.length > 0 && rows.every(validBox)
  },
  'wing_outlines.json': {
    rows: doc => doc?.photos,
    valid: (key, row) => photoKey(key) && row && Array.isArray(row.w) && row.w.length > 0 && row.w.every(validOutline),
    wrap: (doc, photos) => ({ ...doc, photos })
  }
}

// Returns { doc, kept, dropped } with only the valid rows, or { error }.
export function checkReadings(name, doc) {
  const spec = READINGS[name]
  const rows = spec.rows(doc)
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return { error: 'not a JSON object of rows' }
  const good = {}
  let dropped = 0
  for (const [key, row] of Object.entries(rows)) {
    if (spec.valid(key, row)) good[key] = row
    else dropped++
  }
  const kept = Object.keys(good).length
  if (!kept) return { error: `no valid rows (${dropped} invalid)` }
  return { doc: spec.wrap ? spec.wrap(doc, good) : good, kept, dropped }
}

function rowCount(name, path) {
  if (!existsSync(path)) return 0
  try {
    const rows = READINGS[name].rows(JSON.parse(readFileSync(path, 'utf8')))
    return rows && typeof rows === 'object' ? Object.keys(rows).length : 0
  } catch {
    return 0
  }
}

export async function fetchReadings({ base = APP_READINGS_URL, outDir = 'public/data', fetchFn = fetch, log = console.log } = {}) {
  const results = {}
  for (const name of Object.keys(READINGS)) {
    const path = join(outDir, name)
    const keep = reason => { results[name] = { updated: false, reason }; log(`${name}: kept the current copy (${reason})`) }
    let doc
    try {
      const res = await fetchFn(`${base.replace(/\/+$/, '')}/${name}`, { signal: AbortSignal.timeout(120000) })
      if (!res.ok) { keep(`HTTP ${res.status}`); continue }
      doc = JSON.parse(await res.text())
    } catch (error) {
      keep(error?.name === 'SyntaxError' ? 'not JSON' : `unreachable: ${error?.message || error}`)
      continue
    }
    const checked = checkReadings(name, doc)
    if (checked.error) { keep(checked.error); continue }
    const before = rowCount(name, path)
    if (checked.kept < before / 2) { keep(`${checked.kept} rows, the current copy has ${before}`); continue }
    writeFileSync(`${path}.tmp`, JSON.stringify(checked.doc))
    renameSync(`${path}.tmp`, path)
    results[name] = { updated: true, rows: checked.kept, dropped: checked.dropped }
    log(`${name}: ${checked.kept} rows${checked.dropped ? `, ${checked.dropped} invalid left out` : ''} (was ${before})`)
  }
  return results
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await fetchReadings({ base: process.env.APP_READINGS_URL || APP_READINGS_URL, outDir: process.argv[2] || 'public/data' })
    .catch(error => console.log(`Readings not updated: ${error?.message || error}`))
}
