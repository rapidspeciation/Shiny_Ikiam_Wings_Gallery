<script setup>
// Uploaded-photo viewer: a FIXED-height frame with panzoom + a clickable YOLO-mask
// overlay + zoom-to-wings.
//
// Structure (matters — Panzoom forces overflow:hidden on the panzoom element's
// PARENT and measures the focal point relative to it):
//   .ai-photo   fixed-height frame  -> Panzoom sets its overflow:hidden (clip region)
//     .zoom-layer  fills the frame  [PANZOOM ELEMENT]  -> focal point is accurate
//       .img-rect  the contained image rect (centred)  -> overlay + labels live here,
//                  so they pan & zoom WITH the image
//         img, svg mask overlay, conf labels
// Masks select on DOUBLE-click so a single drag never fires a prediction.
import Panzoom from '@panzoom/panzoom'
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { usePanzoomRegistry } from '../composables/usePanzoomRegistry.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'

const props = defineProps({
  src: { type: String, default: '' },
  boxes: { type: Array, default: () => [] },     // [{ box:[x1,y1,x2,y2], conf }]
  usedIndex: { type: Number, default: -1 },      // -2 = all wings, -1 = whole image, >=0 = one mask
  loading: { type: Boolean, default: false },    // a mask prediction is running
  alt: { type: String, default: '' },
  showMasks: { type: Boolean, default: true },   // draw clickable mask overlay (off for reference photos)
  dark: { type: Boolean, default: false },       // dark backdrop (reference hero)
})
const emit = defineEmits(['select'])

const { register, unregister } = usePanzoomRegistry()
const { zoomWings } = useGlobalGalleryOptions()

const frame = ref(null)
const layer = ref(null)
const imgEl = ref(null)
const framed = ref(false)
const layerBox = ref({ left: '0px', top: '0px', width: '100%', height: '100%' })
const geom = ref({ ox: 0, oy: 0, dw: 0, dh: 0, CW: 0, CH: 0 })
let pz = null

// Contained image rect (centred in the fixed frame).
function computeLayer() {
  const fr = frame.value, im = imgEl.value
  if (!fr || !im || !im.naturalWidth) return
  const CW = fr.clientWidth, CH = fr.clientHeight
  const fit = Math.min(CW / im.naturalWidth, CH / im.naturalHeight)
  const dw = im.naturalWidth * fit, dh = im.naturalHeight * fit
  geom.value = { ox: (CW - dw) / 2, oy: (CH - dh) / 2, dw, dh, CW, CH }
  layerBox.value = { left: `${geom.value.ox}px`, top: `${geom.value.oy}px`, width: `${dw}px`, height: `${dh}px` }
}

function initZoom() {
  if (!layer.value || pz) return
  // disablePan:false so the image is draggable at any zoom (incl. full view). On
  // touch we keep touchAction 'pan-y' when not zoomed so the page can still scroll
  // over the image, and switch to 'none' once zoomed in.
  pz = Panzoom(layer.value, { maxScale: 12, minScale: 0.5, touchAction: 'pan-y', disablePan: false, cursor: 'grab' })
  register(pz)
  const wheelHandler = (e) => { if (e.ctrlKey) { e.preventDefault(); pz.zoomWithWheel(e) } }
  layer.value.parentElement.addEventListener('wheel', wheelHandler)
  pz._wheelHandler = wheelHandler
  layer.value.addEventListener('panzoomzoom', (e) => {
    const s = e.detail.scale
    pz.setOptions(s > 1.05 ? { touchAction: 'none', cursor: 'move' } : { touchAction: 'pan-y', cursor: 'grab' })
  })
  layer.value.addEventListener('panzoomreset', () => {
    pz.setOptions({ touchAction: 'pan-y', cursor: 'grab' })
  })
}
function destroyZoom() {
  if (!pz) return
  if (layer.value?.parentElement && pz._wheelHandler) layer.value.parentElement.removeEventListener('wheel', pz._wheelHandler)
  pz.destroy(); unregister(pz); pz = null
}

// Box (normalised, image-relative) to frame: the selected mask, else union of all.
function frameBox() {
  if (props.usedIndex >= 0 && props.boxes[props.usedIndex]) return props.boxes[props.usedIndex].box
  if (props.boxes.length) {
    let x1 = 1, y1 = 1, x2 = 0, y2 = 0
    for (const b of props.boxes) { x1 = Math.min(x1, b.box[0]); y1 = Math.min(y1, b.box[1]); x2 = Math.max(x2, b.box[2]); y2 = Math.max(y2, b.box[3]) }
    return [x1, y1, x2, y2]
  }
  return null
}
function applyWingFrame() {
  if (!pz || !frame.value) return
  const b = frameBox()
  if (!b) { pz.reset({ animate: false }); return }
  const { ox, oy, dw, dh, CW, CH } = geom.value
  if (!CW || !CH || !dw || !dh) return
  // bbox centre + size in LAYER (= frame) px, accounting for the image-rect offset
  const cxpx = ox + ((b[0] + b[2]) / 2) * dw
  const cypx = oy + ((b[1] + b[3]) / 2) * dh
  const bwpx = (b[2] - b[0]) * dw, bhpx = (b[3] - b[1]) * dh
  if (bwpx < 2 || bhpx < 2) return
  const scale = Math.min(12, Math.min(CW / bwpx, CH / bhpx))   // fill the frame, no buffer
  pz.zoom(scale, { animate: false })
  pz.pan(CW / 2 - cxpx, CH / 2 - cypx, { animate: false, force: true })
  pz.setOptions({ disablePan: false, touchAction: 'none', cursor: 'move' })
}
function refreshFrame() {
  if (framed.value && frameBox()) nextTick(applyWingFrame)
  else if (pz) pz.reset({ animate: false })
}
function toggleFrame() { framed.value = !framed.value; refreshFrame() }

function onImgLoad() { computeLayer(); if (framed.value) nextTick(applyWingFrame); else if (pz) pz.reset({ animate: false }) }
function onResize() { computeLayer(); refreshFrame() }
const fmtConf = (c) => (typeof c === 'number' && !Number.isNaN(c) ? `${Math.round(c * 100)}%` : '')

watch(zoomWings, (on) => { framed.value = on; refreshFrame() })
watch(() => props.usedIndex, () => { if (framed.value) refreshFrame() })
watch(() => props.boxes, () => { computeLayer(); if (framed.value) nextTick(applyWingFrame) }, { deep: true })

onMounted(async () => {
  await nextTick(); initZoom()
  framed.value = zoomWings.value
  window.addEventListener('resize', onResize)
  computeLayer()
  if (framed.value) applyWingFrame()
})
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); destroyZoom() })
</script>

<template>
  <div ref="frame" class="ai-photo" :class="{ dark }">
    <div ref="layer" class="zoom-layer">
      <div class="img-rect" :style="layerBox">
        <img ref="imgEl" :src="src" class="panzoom-img" :alt="alt" referrerpolicy="no-referrer" @load="onImgLoad" />
        <!-- clickable wing-mask overlay (aligned to the image; pans/zooms with it) -->
        <svg v-if="showMasks && boxes.length" class="mask-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
          <rect v-for="(b, i) in boxes" :key="i"
            :x="b.box[0]" :y="b.box[1]"
            :width="Math.max(0, b.box[2] - b.box[0])" :height="Math.max(0, b.box[3] - b.box[1])"
            class="mask-rect" :class="{ used: usedIndex === -2 || i === usedIndex }"
            @dblclick.stop.prevent="emit('select', i)" />
        </svg>
        <!-- conf labels, anchored to each bbox (so they travel with the image) -->
        <template v-if="showMasks && boxes.length">
          <button v-for="(b, i) in boxes" :key="'lbl-' + i" type="button"
            class="mask-lbl" :class="{ used: usedIndex === -2 || i === usedIndex }"
            :style="{ left: (b.box[0] * 100) + '%', top: (b.box[1] * 100) + '%' }"
            :title="'Double-click to use this mask'"
            @dblclick.stop.prevent="emit('select', i)">
            {{ (usedIndex === -2 || i === usedIndex) ? '✓ ' : '' }}mask {{ i + 1 }} {{ fmtConf(b.conf) }}
          </button>
        </template>
      </div>
    </div>
    <!-- per-image zoom-to-wings button (in addition to the global navbar toggle) -->
    <button v-if="boxes.length" type="button" class="btn btn-sm frame-btn"
      :class="framed ? 'btn-primary' : 'btn-light'" @click.stop="toggleFrame"
      :title="framed ? 'Show the whole photo' : 'Zoom to the detected wings'">
      {{ framed ? 'Show full photo' : '🔍 Zoom to wings' }}
    </button>
    <div v-if="loading" class="mask-loading">
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Running this mask…
    </div>
  </div>
</template>

<style scoped>
.ai-photo { position: relative; width: 100%; height: 380px; overflow: hidden; background: #f1f5f9; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: .5rem; }
.ai-photo.dark { background: #0f172a; border-color: #0f172a; margin-bottom: 0; }
.zoom-layer { position: absolute; inset: 0; line-height: 0; cursor: grab; transform-origin: center center; }
.img-rect { position: absolute; pointer-events: none; }
.panzoom-img { width: 100%; height: 100%; object-fit: fill; display: block; }
.mask-overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
.mask-rect { fill: rgba(120,120,120,.04); stroke: #9aa3ad; stroke-width: 2; vector-effect: non-scaling-stroke; cursor: pointer; pointer-events: auto; transition: stroke .15s; }
.mask-rect:hover { stroke: #16a34a; }
.mask-rect.used { stroke: #16a34a; stroke-width: 3; fill: rgba(22,163,74,.06); }
.frame-btn { position: absolute; bottom: 8px; right: 8px; z-index: 4; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.mask-lbl { position: absolute; transform: translateY(-100%); pointer-events: auto; border: none; background: #6b7280; color: #fff; font-size: 10px; font-weight: 700; line-height: 1.2; padding: 0 4px; border-radius: 3px 3px 3px 0; cursor: pointer; white-space: nowrap; }
.mask-lbl.used { background: #16a34a; }
.mask-loading { position: absolute; bottom: 8px; left: 8px; z-index: 4; background: rgba(15,23,42,.85); color: #fff; font-size: .75rem; padding: 3px 8px; border-radius: 6px; display: flex; align-items: center; gap: .4rem; }
@media (max-width: 575px) { .ai-photo { height: 300px; } }
</style>
