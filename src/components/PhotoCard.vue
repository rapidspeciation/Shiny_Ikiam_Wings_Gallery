<script setup>
import Panzoom from '@panzoom/panzoom'
import { onMounted, onBeforeUnmount, ref, reactive, computed, watch, nextTick } from 'vue'
import { usePanzoomRegistry } from '../composables/usePanzoomRegistry.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import { getBoxes } from '../composables/useCurationData.js'
import { getProxiedUrl, notifyTierFailed, getProxyState } from '../utils/imageProxy.js'
import PredictionPanel from './PredictionPanel.vue'

const props = defineProps({
  item: Object,
  side: String
})

const { register, unregister } = usePanzoomRegistry()
const { showBoxes, zoomWings } = useGlobalGalleryOptions()

const imgRefs = ref([])
const layerRefs = ref([])

// Per-photo curation state, keyed by render index.
//   boxes:  array of { box:[x1,y1,x2,y2], conf }
//   loaded: whether a fetch for this photo has resolved
const photoState = reactive({})

// --- IMAGE PROXY LOGIC ---
const { mode: proxyModeRef, tierStatus: tierStatusRef } = getProxyState()

const proxyVersion = computed(() => JSON.stringify({
  mode: proxyModeRef.value,
  tiers: tierStatusRef.value
}))

const resolvePhotoUrl = (url) => {
  void proxyVersion.value
  return getProxiedUrl(url)
}

const handleImgError = (e, originalUrl) => {
  const currentSrc = e.target.src

  if (proxyModeRef.value === 'auto') {
    const canFallToLh3 = currentSrc.includes('wsrv.nl') && tierStatusRef.value.lh3 !== 'blocked'
    const canFallToThumb = (currentSrc.includes('wsrv.nl') || currentSrc.includes('lh3.google')) && tierStatusRef.value.thumbnail !== 'blocked'

    if (canFallToLh3 || canFallToThumb) {
      notifyTierFailed(currentSrc)
      e.target.src = resolvePhotoUrl(originalUrl)
      return
    }
  }

  notifyTierFailed(currentSrc)
}
// -------------------------

// --- Panzoom ---
// Attached to the .zoom-layer (NOT the <img>) so the image and its wing-box
// overlay pan/zoom together. Stays live in every mode; "zoom to wings" just sets
// the initial frame via panzoom (see applyWingFrame) instead of replacing it.
const pzInstances = []   // parallels layerRefs by index

const initZoom = (el) => {
  if (!el) return null

  const pz = Panzoom(el, {
    maxScale: 8,
    minScale: 0.5,
    touchAction: 'pan-y',
    disablePan: true
  })

  register(pz)

  const wheelHandler = (e) => {
    if (e.ctrlKey) {
      e.preventDefault()
      pz.zoomWithWheel(e)
    }
  }
  el.parentElement.addEventListener('wheel', wheelHandler)
  pz._wheelHandler = wheelHandler   // stash for cleanup

  el.addEventListener('panzoomzoom', (e) => {
    const currentScale = e.detail.scale
    if (currentScale > 1.05) {
      pz.setOptions({ disablePan: false, touchAction: 'none', cursor: 'move' })
    } else {
      pz.setOptions({ disablePan: true, touchAction: 'pan-y', cursor: 'grab' })
    }
  })

  el.addEventListener('panzoomreset', () => {
    pz.setOptions({ disablePan: true, touchAction: 'pan-y', cursor: 'grab' })
  })

  return pz
}

const destroyPz = (pz, el) => {
  if (!pz) return
  if (el && pz._wheelHandler && el.parentElement) {
    el.parentElement.removeEventListener('wheel', pz._wheelHandler)
  }
  pz.destroy()
  unregister(pz)
}

const attachPanzoomAll = () => {
  layerRefs.value.forEach((el, i) => {
    if (el && !pzInstances[i]) {
      pzInstances[i] = initZoom(el)
    }
  })
}

const detachPanzoomAll = () => {
  pzInstances.forEach((pz, i) => destroyPz(pz, layerRefs.value[i]))
  pzInstances.length = 0
}

// --- Wing-box loading (lazy, on first need per photo) ---
const ensureBoxes = async (index, name) => {
  if (photoState[index] && photoState[index].loaded) return
  if (!photoState[index]) photoState[index] = { boxes: [], loaded: false }
  const boxes = await getBoxes(name)
  photoState[index] = { boxes, loaded: true }
}

// Returns a promise that resolves once every visible photo's boxes are in
// photoState, so callers can `await` it before framing (avoids a race where
// framing runs before the boxes have loaded).
const loadVisibleBoxes = () => {
  const photos = displayPhotos()
  return Promise.all(photos.map((photo, index) => ensureBoxes(index, photo.Name)))
}

// Union bbox of all boxes for a photo, or null if none.
const unionBox = (boxes) => {
  if (!Array.isArray(boxes) || boxes.length === 0) return null
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0
  for (const b of boxes) {
    const box = b && b.box
    if (!Array.isArray(box) || box.length < 4) continue
    const [bx1, by1, bx2, by2] = box
    if ([bx1, by1, bx2, by2].some(v => typeof v !== 'number' || Number.isNaN(v))) continue
    x1 = Math.min(x1, bx1); y1 = Math.min(y1, by1)
    x2 = Math.max(x2, bx2); y2 = Math.max(y2, by2)
  }
  if (x2 <= x1 || y2 <= y1) return null
  return { x1, y1, x2, y2 }
}

// Frame the union wing bbox THROUGH panzoom, so the user can keep zooming/panning
// from there. Panzoom transform is `scale(S) translate(Xpx,Ypx)` about the layer's
// centre, so to put the bbox centre (cx,cy) at the viewport centre: X=W(0.5-cx),
// Y=H(0.5-cy). No-op (and retried later) until both boxes and image size are ready.
const applyWingFrame = (index) => {
  const el = layerRefs.value[index]
  const pz = pzInstances[index]
  const st = photoState[index]
  if (!el || !pz || !st || !st.loaded) return
  const u = unionBox(st.boxes)
  if (!u) { pz.reset({ animate: false }); return }
  const W = el.offsetWidth, H = el.offsetHeight
  if (!W || !H) return
  const cx = (u.x1 + u.x2) / 2, cy = (u.y1 + u.y2) / 2
  const scale = Math.min(8, 0.95 / Math.max(u.x2 - u.x1, u.y2 - u.y1))
  pz.zoom(scale, { animate: false })
  // force: true — pan() is a no-op while disablePan is set (the panel's default),
  // which would frame off-centre wings on the image middle instead of the bbox.
  pz.pan(W * (0.5 - cx), H * (0.5 - cy), { animate: false, force: true })
  // we're zoomed in now, so allow dragging straight away (don't wait on the event)
  pz.setOptions({ disablePan: false, touchAction: 'none', cursor: 'move' })
}

const applyWingFramesAll = () => displayPhotos().forEach((_, i) => applyWingFrame(i))

// img onload: dimensions are now known, so (re)apply the wing frame if active.
const onImgLoad = (index) => { if (zoomWings.value) applyWingFrame(index) }

const boxesFor = (index) => {
  const st = photoState[index]
  return st && st.loaded ? st.boxes : []
}

const fmtConf = (conf) => {
  if (typeof conf !== 'number' || Number.isNaN(conf)) return ''
  return `${Math.round(conf * 100)}%`
}

// --- Reactive orchestration --------------------------------------------

// Zoom-to-wings keeps panzoom LIVE and just sets the initial frame. When it turns
// on, load boxes then frame each photo; when off, reset every instance to neutral.
watch(zoomWings, async (on) => {
  if (on) {
    await loadVisibleBoxes()
    await nextTick()
    applyWingFramesAll()
  } else {
    pzInstances.forEach(pz => pz && pz.reset({ animate: false }))
  }
})

// Boxes are needed when overlays are on OR when zooming to wings.
watch([showBoxes, zoomWings], ([sb, zw]) => {
  if (sb || zw) loadVisibleBoxes()
})

onMounted(async () => {
  await nextTick()
  attachPanzoomAll()
  if (showBoxes.value || zoomWings.value) {
    await loadVisibleBoxes()
    await nextTick()
    if (zoomWings.value) applyWingFramesAll()
  }
})

onBeforeUnmount(() => {
  detachPanzoomAll()
})

const displayPhotos = () => {
  let list = []
  if (props.item.all_photos && props.item.all_photos.length > 0) {
    list = props.item.all_photos.filter(p => {
      if (props.side === 'Dorsal' && !p.Name.includes('d.JPG')) return false
      if (props.side === 'Ventral' && !p.Name.includes('v.JPG')) return false
      return true
    })
  } else {
    if ((props.side.includes('Dorsal') || props.side === 'Dorsal and Ventral') && props.item.URLd) {
      list.push({ URL_to_view: props.item.URLd, Name: 'Dorsal' })
    }
    if ((props.side.includes('Ventral') || props.side === 'Dorsal and Ventral') && props.item.URLv) {
      list.push({ URL_to_view: props.item.URLv, Name: 'Ventral' })
    }
  }

  return list.sort((a, b) => {
    const nameA = a.Name.toLowerCase()
    const nameB = b.Name.toLowerCase()
    const isDorsalA = nameA.includes('d.jpg')
    const isDorsalB = nameB.includes('d.jpg')
    const isVentralA = nameA.includes('v.jpg')
    const isVentralB = nameB.includes('v.jpg')

    if (isDorsalA && !isDorsalB) return -1
    if (!isDorsalA && isDorsalB) return 1
    if (isVentralA && !isVentralB) return -1
    if (!isVentralA && isVentralB) return 1
    return nameA.localeCompare(nameB)
  })
}
</script>

<template>
  <div class="gallery-card h-100 border rounded bg-white d-flex flex-column">
    <h5 class="fw-bold text-center mt-2">{{ item.CAM_ID }}</h5>

    <div class="photo-grid-container p-2">
       <div v-for="(photo, index) in displayPhotos()" :key="index" class="img-wrapper">
         <!-- zoom-layer holds img + overlay together so the SVG zooms WITH the image -->
         <div
           class="zoom-layer"
           :ref="el => layerRefs[index] = el"
         >
           <img
             :ref="el => imgRefs[index] = el"
             :src="resolvePhotoUrl(photo.URL_to_view)"
             class="panzoom-img"
             loading="lazy"
             referrerpolicy="no-referrer"
             :alt="photo.Name"
             @load="onImgLoad(index)"
             @error="(e) => handleImgError(e, photo.URL_to_view)"
           >

           <!-- Wing-box SVG overlay (stroke only; no fill, no svg text) -->
           <svg
             v-if="showBoxes && boxesFor(index).length"
             class="wing-overlay"
             viewBox="0 0 1 1"
             preserveAspectRatio="none"
             aria-hidden="true"
           >
             <rect
               v-for="(b, bi) in boxesFor(index)"
               :key="bi"
               :x="b.box[0]"
               :y="b.box[1]"
               :width="Math.max(0, b.box[2] - b.box[0])"
               :height="Math.max(0, b.box[3] - b.box[1])"
               class="wing-rect"
             />
           </svg>

           <!-- Confidence labels as HTML (so they don't distort with the SVG) -->
           <template v-if="showBoxes">
             <span
               v-for="(b, bi) in boxesFor(index)"
               :key="'lbl-' + bi"
               class="wing-conf"
               :style="{ left: (b.box[0] * 100) + '%', top: (b.box[1] * 100) + '%' }"
             >{{ fmtConf(b.conf) }}</span>
           </template>
         </div>
       </div>
    </div>

    <div class="mt-2 text-start small bg-light p-2 rounded-bottom border-top">
      <div class="row g-1">
        <div :class="[item.Subspecies_Form && item.Subspecies_Form !== 'None' ? 'col-6' : 'col-12']">
          <strong>Species:</strong><br> {{ item.Species }}
        </div>
        <div class="col-6" v-if="item.Subspecies_Form && item.Subspecies_Form !== 'None' && item.Subspecies_Form !== 'NA'">
            <strong>Subsp:</strong><br> {{ item.Subspecies_Form }}
        </div>
        <div class="w-100"></div>
        <div class="col-6"><strong>Sex:</strong> {{ item.Sex || 'NA' }}</div>
        <div class="col-6"><strong>Date:</strong> {{ item.Preservation_date_formatted }}</div>
        <div class="w-100" v-if="item.Insectary_ID || item.Mutant"></div>
        <div class="col-6" v-if="item.Insectary_ID"><strong>Ins. ID:</strong> {{ item.Insectary_ID }}</div>
        <div class="col-6" v-if="item.Mutant && item.Mutant !== 'NA'"><strong>Mutant:</strong> {{ item.Mutant }}</div>
      </div>

      <!-- Curation aid: model predictions + source cross-links -->
      <PredictionPanel :item="item" />
    </div>
  </div>
</template>

<style scoped>
.photo-grid-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-content: start;   /* top-align images so cards in a row line up (don't centre in stretched height) */
  min-height: 200px;
}
.img-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  width: 100%;
  position: relative;
}
.img-wrapper:only-child { grid-column: span 2; }

/* The zoom-layer wraps img + overlay so panzoom transforms them together. */
.zoom-layer {
  position: relative;
  width: 100%;
  line-height: 0;
  cursor: grab;
}

.panzoom-img {
  width: 100%;
  height: auto;
  object-fit: contain;
  cursor: grab;
  display: block;
}

/* SVG overlay covers exactly the image box. */
.wing-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.wing-rect {
  fill: none;
  stroke: #00e0ff;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

/* HTML confidence label pinned to a box's top-left corner. */
.wing-conf {
  position: absolute;
  transform: translateY(-100%);
  background: #00e0ff;
  color: #003a44;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.1;
  padding: 0 2px;
  border-radius: 2px;
  pointer-events: none;
  white-space: nowrap;
}
</style>
