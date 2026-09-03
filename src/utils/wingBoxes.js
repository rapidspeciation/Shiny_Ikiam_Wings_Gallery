// Pure Wings-v6 geometry helpers.  The frozen payload contains one union box
// per photo, but these helpers also accept multiple valid detections and never
// silently select only the first/forewing pair.

function validBox(row) {
  const box = row?.box
  return Array.isArray(box) && box.length === 4 && box.every(value => Number.isFinite(value)) &&
    box[0] >= 0 && box[1] >= 0 && box[2] <= 1 && box[3] <= 1 && box[0] < box[2] && box[1] < box[3]
}

function clamp(value) {
  return Math.min(1, Math.max(0, value))
}

export function unionBox(boxes, { padding = 0.02, aspect = 1, clampToImage = true } = {}) {
  const valid = (Array.isArray(boxes) ? boxes : []).filter(validBox)
  if (!valid.length) return null
  let x1 = Math.min(...valid.map(row => row.box[0]))
  let y1 = Math.min(...valid.map(row => row.box[1]))
  let x2 = Math.max(...valid.map(row => row.box[2]))
  let y2 = Math.max(...valid.map(row => row.box[3]))
  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 0
  const dx = (x2 - x1) * pad
  const dy = (y2 - y1) * pad
  x1 -= dx; x2 += dx; y1 -= dy; y2 += dy

  // Keep a modest minimum viewport aspect without moving the union's centre.
  const targetAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  let width = x2 - x1, height = y2 - y1
  if (width / height < targetAspect) {
    const target = height * targetAspect
    x1 -= (target - width) / 2; x2 += (target - width) / 2
  } else if (height / width < 1 / targetAspect) {
    const target = width / targetAspect
    y1 -= (target - height) / 2; y2 += (target - height) / 2
  }
  if (clampToImage) {
    x1 = clamp(x1); y1 = clamp(y1); x2 = clamp(x2); y2 = clamp(y2)
  }
  return x2 > x1 && y2 > y1 ? { x1, y1, x2, y2 } : null
}

export function unionBoxScale(box, maxScale = 8, fit = 0.95) {
  if (!box) return 1
  const safeMax = Number.isFinite(maxScale) && maxScale > 0 ? maxScale : 8
  const safeFit = Number.isFinite(fit) && fit > 0 ? fit : 0.95
  return Math.min(safeMax, safeFit / Math.max(box.x2 - box.x1, box.y2 - box.y1))
}
