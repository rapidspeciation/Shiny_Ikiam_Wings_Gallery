import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
test('About shows expanded-pair held-out results and dated history separately', () => {
  const about = readFileSync('src/components/AIIdTab.vue', 'utf8')
  const current = about.split('<strong>Changelog</strong>')[0].split('About this tool')[1]
  assert.doesNotMatch(current, /<strong>\d{1,2} September 2026:<\/strong>/)
  for (const copy of ['3,829', '<td>2,613</td><td>87.93%</td><td>97.33%</td>',
    '<td>3,355</td><td>91.33%</td><td>97.91%</td>', '0.21 pp', '0.74 pp',
    'Previous collection validation', 'Paired attention validation',
    '<tr><td>Named subspecies</td><td>296</td><td>89.86%</td><td>98.65%</td></tr>',
    '<tr><td>Species</td><td>314</td><td>95.22%</td><td>99.04%</td></tr>',
    '<tr><td>Genus</td><td>314</td><td>98.09%</td><td>99.36%</td></tr>',
    'matched single-photo ensemble', 'Subspecies Top-1 difference of +0.96 points on 278',
    'Their paired 95% intervals include zero', 'named Subspecies Top-5 decreased from 99.64% to 99.28%',
    'AI Identifier field-photo validation',
    '<tr><td>Species</td><td>4,566</td><td>73.37%</td><td>92.05%</td></tr>',
    '<tr><td>Genus</td><td>4,566</td><td>90.63%</td><td>97.22%</td></tr>',
    'geographic weighting off unless', 'paired collection evaluations',
    '12 February to 7 September', 'after the BioCLIP 2.5-H weights were released',
    '<strong>Sex prediction</strong>', 'Sex prediction is not yet supported for uploaded photos.',
    'single-photo head and original wing-cropper:', 'collection attention weights:',
    'href="https://huggingface.co/spaces/fr4nzzch/butterfly-id/blob/main/assets/wing_seg_v6.pt"',
    'href="https://github.com/rapidspeciation/Shiny_Ikiam_Wings_Gallery/releases/tag/collection-attention-20260926"',
    'table uses held-out predictions']) assert.ok(current.includes(copy), copy)
  assert.doesNotMatch(current, /Review candidates \(CSV\)|Taxon reliability \(CSV\)/)
  assert.doesNotMatch(current, /558 training-image taxon labels|first.publication/)
  for (const copy of ['<strong>26 September 2026:</strong>', '<strong>10 September 2026:</strong>', '(+0.85 pp, Top-5: 97.91%)',
    '(+0.87 pp, Top-5: 97.33%)', '<strong>9 September 2026:</strong>',
    'from 67.50% to 73.37% (+5.87 percentage points)', 'from 85.59% to',
    '92.05% (+6.46 points)', 'combined workflow changes']) assert.ok(about.includes(copy), copy)
})
