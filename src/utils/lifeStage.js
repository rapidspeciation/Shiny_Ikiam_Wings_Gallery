// Life-stage note of the AI Identifier (since 14 October 2026).
//
// The Space adds `life_stage` to each /predict_raw result: class probabilities from a small head on the same
// photo crop the identifier uses, P(not adult) and a flag ("immature", "label_or_preparation" or null) set when
// P(not adult) reaches the threshold fixed during validation. The note never changes the identification.
const FLAGS = new Set(['immature', 'label_or_preparation'])

export const LIFE_STAGE_NOTES = {
  immature: 'This photo may show an immature stage; names are trained on adults and may be unreliable.',
  label_or_preparation: 'This photo may show a specimen label or a preparation rather than a whole insect; names may be unreliable.',
}

export function normalizeLifeStage(value) {
  if (!value || typeof value !== 'object') return null
  const notAdult = value.not_adult
  if (typeof notAdult !== 'number' || !Number.isFinite(notAdult) || notAdult < 0 || notAdult > 1) return null
  const flag = FLAGS.has(value.flag) ? value.flag : null
  return { flag, notAdult }
}

// The short note for a result, or '' when the photo looks like an adult (or no life-stage answer came back).
export function lifeStageNote(value) {
  const stage = normalizeLifeStage(value)
  return stage?.flag ? LIFE_STAGE_NOTES[stage.flag] : ''
}
