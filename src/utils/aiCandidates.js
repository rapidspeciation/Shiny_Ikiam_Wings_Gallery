// Flat, species-first candidate list for the AI Identifier results view, built
// from rankLeaves() output (so it already reflects the current geographic
// re-rank). Pure helpers, unit tested in tests/ai-candidates.test.mjs.

// A subspecies is offered as a chip under its species when it holds at least
// this much probability (same threshold PredictionPanel uses for suggestions).
export const SUBSP_CHIP_MIN = 0.05
export const SUBSP_CHIPS_MAX = 2

export function fmtPct(p) {
  if (typeof p !== 'number' || Number.isNaN(p)) return ''
  if (p > 0 && p < 0.005) return '<1%'
  return `${Math.round(p * 100)}%`
}

const epithetOf = (t) => t.trim().split(/\s+/).slice(2).join(' ')

// pred.species rows are [name, prob, oor, [[ssp, prob, oor], ...]].
export function speciesCandidates(pred, n = 5) {
  return (pred?.species || []).slice(0, n).map(([taxon, prob, oor, subs]) => ({
    taxon,
    prob,
    oor: !!oor,
    subspecies: (subs || [])
      .filter(([, p]) => p >= SUBSP_CHIP_MIN)
      .slice(0, SUBSP_CHIPS_MAX)
      .map(([t, p, o]) => ({ taxon: t, epithet: epithetOf(t), prob: p, oor: !!o })),
  }))
}

export function genusSummary(pred, n = 4) {
  return (pred?.genus || []).slice(0, n).map(([taxon, prob]) => ({ taxon, prob }))
}

export function formatGenusSummary(pred, n = 4) {
  const parts = genusSummary(pred, n).map((g) => `${g.taxon} ${fmtPct(g.prob)}`)
  if (!parts.length) return ''
  const more = (pred?.genus || []).length > n ? ' · …' : ''
  return parts.join(' · ') + more
}

// Probability + off-region flag of a species or subspecies in the ranked prediction.
export function taxonInfo(pred, taxon) {
  if (!pred || !taxon) return null
  for (const [sp, p, oor, subs] of pred.species || []) {
    if (sp === taxon) return { taxon, prob: p, oor: !!oor, rank: 'species' }
    for (const [ss, sp2, o2] of subs || []) if (ss === taxon) return { taxon, prob: sp2, oor: !!o2, rank: 'subspecies' }
  }
  for (const [ss, p, oor] of pred.subspecies || []) if (ss === taxon) return { taxon, prob: p, oor: !!oor, rank: 'subspecies' }
  for (const [sp, p, oor] of pred.species_all || []) if (sp === taxon) return { taxon, prob: p, oor: !!oor, rank: 'species' }
  return null
}

// Taxa in list order (species, then its subspecies chips), for keyboard navigation.
export function candidateOrder(cands) {
  const out = []
  for (const c of cands) { out.push(c.taxon); for (const s of c.subspecies) out.push(s.taxon) }
  return out
}

// Keep the current selection when it is still in the visible list and the user
// chose it; otherwise select the first species.
export function pickSelection(cands, current, userPicked = false) {
  if (!cands.length) return ''
  if (current && userPicked && candidateOrder(cands).includes(current)) return current
  return cands[0].taxon
}

// Move the selection up/down through the visible taxa (clamped at the ends).
export function stepSelection(cands, current, delta) {
  const order = candidateOrder(cands)
  if (!order.length) return ''
  const i = order.indexOf(current)
  if (i < 0) return order[0]
  return order[Math.max(0, Math.min(order.length - 1, i + delta))]
}
