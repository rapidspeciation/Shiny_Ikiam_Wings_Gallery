<script setup>
// Uploaded-photo viewer for the AI Identifier tab. Mirrors PhotoCard's panzoom +
// wing-box overlay, but the boxes are the YOLO masks returned per upload and they
// are CLICKABLE: tapping a mask selects it (parent re-runs BioCLIP on that crop).
// The used mask is green, the others grey ("plomo"). Reacts to the global
// "Zoom to wings" navbar toggle to frame the selected mask through panzoom.
import Panzoom from '@panzoom/panzoom'
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { usePanzoomRegistry } from '../composables/usePanzoomRegistry.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'

const props = defineProps({
  src: { type: String, default: '' },
  boxes: { type: Array, default: () => [] },     // [{ box:[x1,y1,x2,y2], conf }]
  usedIndex: { type: Number, default: -1 },      // -1 = whole image
  loading: { type: Boolean, default: false },    // a mask prediction is running
  alt: { type: String, default: '' },
  showMasks: { type: Boolean, default: true },   // draw clickable mask overlay (off for reference photos)
  dark: { type: Boolean, default: false },       // dark backdrop (reference hero)
})
const emit = defineEmits(['select'])

const { register, unregister } = usePanzoomRegistry()
const { zoomWings } = useGlobalGalleryOptions()

const layer = ref(null)
const imgEl = ref(null)
let pz = null

function initZoom() {
  if (!layer.value || pz) return
  pz = Panzoom(layer.value, { maxScale: 8, minScale: 0.5, touchAction: 'pan-y', disablePan: true })
  register(pz)
  const wheelHandler = (e) => { if (e.ctrlKey) { e.preventDefault(); pz.zoomWithWheel(e) } }
  layer.value.parentElement.addEventListener('wheel', wheelHandler)
  pz._wheelHandler = wheelHandler
  layer.value.addEventListener('panzoomzoom', (e) => {
    const s = e.detail.scale
    pz.setOptions(s > 1.05
      ? { disablePan: false, touchAction: 'none', cursor: 'move' }
      : { disablePan: true, touchAction: 'pan-y', cursor: 'grab' })
  })
  layer.value.addEventListener('panzoomreset', () => {
    pz.setOptions({ disablePan: true, touchAction: 'pan-y', cursor: 'grab' })
  })
}
function destroyZoom() {
  if (!pz) return
  if (layer.value?.parentElement && pz._wheelHandler) layer.value.parentElement.removeEventListener('wheel', pz._wheelHandler)
  pz.destroy(); unregister(pz); pz = null
}

// Union of the selected mask (or all masks when whole-image) for framing.
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
  if (!pz || !layer.value) return
  const b = frameBox()
  if (!b) { pz.reset({ animate: false }); return }
  const W = layer.value.offsetWidth, H = layer.value.offsetHeight
  if (!W || !H) return
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2
  const scale = Math.min(8, 0.95 / Math.max(b[2] - b[0], b[3] - b[1]))
  pz.zoom(scale, { animate: false })
  pz.pan(W * (0.5 - cx), H * (0.5 - cy), { animate: false, force: true })
  pz.setOptions({ disablePan: false, touchAction: 'none', cursor: 'move' })
}
function refreshFrame() {
  if (zoomWings.value) nextTick(applyWingFrame)
  else if (pz) pz.reset({ animate: false })
}

const onImgLoad = () => { if (zoomWings.value) nextTick(applyWingFrame) }
const fmtConf = (c) => (typeof c === 'number' && !Number.isNaN(c) ? `${Math.round(c * 100)}%` : '')

watch(zoomWings, refreshFrame)
watch(() => props.usedIndex, refreshFrame)
watch(() => props.boxes, () => { if (zoomWings.value) nextTick(applyWingFrame) }, { deep: true })

onMounted(async () => { await nextTick(); initZoom(); if (zoomWings.value) applyWingFrame() })
onBeforeUnmount(destroyZoom)
</script>

<template>
  <div class="ai-photo" :class="{ dark }">
    <div ref="layer" class="zoom-layer">
      <img ref="imgEl" :src="src" class="panzoom-img" :alt="alt" referrerpolicy="no-referrer" @load="onImgLoad" />
      <!-- clickable wing-mask overlay -->
      <svg v-if="showMasks && boxes.length" class="mask-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
        <rect v-for="(b, i) in boxes" :key="i"
          :x="b.box[0]" :y="b.box[1]"
          :width="Math.max(0, b.box[2] - b.box[0])" :height="Math.max(0, b.box[3] - b.box[1])"
          class="mask-rect" :class="{ used: i === usedIndex }"
          @click.stop="emit('select', i)" />
      </svg>
    </div>
    <!-- conf labels + click targets as HTML (don't distort with the SVG) -->
    <template v-if="showMasks && boxes.length">
      <button v-for="(b, i) in boxes" :key="'lbl-' + i" type="button"
        class="mask-lbl" :class="{ used: i === usedIndex }"
        :style="{ left: (b.box[0] * 100) + '%', top: (b.box[1] * 100) + '%' }"
        :title="i === usedIndex ? 'Mask used for this prediction' : 'Use this mask'"
        @click.stop="emit('select', i)">
        {{ i === usedIndex ? '✓ ' : '' }}mask {{ i + 1 }} {{ fmtConf(b.conf) }}
      </button>
    </template>
    <div v-if="loading" class="mask-loading">
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Running this mask…
    </div>
  </div>
</template>

<style scoped>
.ai-photo { position: relative; width: 100%; height: 340px; overflow: hidden; background: #f1f5f9; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: .5rem; }
.ai-photo.dark { background: #0f172a; border-color: #0f172a; margin-bottom: 0; }
.zoom-layer { position: relative; width: 100%; height: 100%; line-height: 0; cursor: grab; }
.panzoom-img { width: 100%; height: 100%; object-fit: contain; display: block; }
.mask-overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
.mask-rect { fill: rgba(120,120,120,.06); stroke: #9aa3ad; stroke-width: 2; vector-effect: non-scaling-stroke; cursor: pointer; transition: stroke .15s; }
.mask-rect:hover { stroke: #16a34a; }
.mask-rect.used { stroke: #16a34a; stroke-width: 3; fill: rgba(22,163,74,.08); }
.mask-lbl { position: absolute; transform: translateY(-100%); border: none; background: #6b7280; color: #fff; font-size: 10px; font-weight: 700; line-height: 1.2; padding: 0 4px; border-radius: 3px 3px 3px 0; cursor: pointer; white-space: nowrap; }
.mask-lbl.used { background: #16a34a; }
.mask-loading { position: absolute; bottom: 8px; left: 8px; background: rgba(15,23,42,.85); color: #fff; font-size: .75rem; padding: 3px 8px; border-radius: 6px; display: flex; align-items: center; gap: .4rem; }
</style>
