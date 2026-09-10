import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
test('About shows expanded-pair held-out results and dated history separately', () => {
  const about = readFileSync('src/components/AIIdTab.vue', 'utf8')
  const current = about.split('<strong>Changelog</strong>')[0].split('About this tool')[1]
  assert.doesNotMatch(current, /\d{1,2} September 2026/)
  for (const copy of ['3,829', '<td>2,613</td><td>87.93%</td><td>97.33%</td>',
    '<td>3,355</td><td>91.33%</td><td>97.91%</td>', '0.21 pp', '0.74 pp',
    '<strong>Sex prediction</strong>', 'Sex prediction is not yet supported for uploaded photos.',
    'table uses held-out predictions']) assert.ok(current.includes(copy), copy)
  assert.doesNotMatch(current, /Review candidates \(CSV\)|Taxon reliability \(CSV\)/)
  for (const copy of ['<strong>10 September 2026:</strong>', '(+0.85 pp, Top-5: 97.91%)',
    '(+0.87 pp, Top-5: 97.33%)', '<strong>9 September 2026:</strong>']) assert.ok(about.includes(copy), copy)
})
