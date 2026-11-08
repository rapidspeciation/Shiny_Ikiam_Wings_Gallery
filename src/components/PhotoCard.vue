<script setup>
import Panzoom from '@panzoom/panzoom'
import { onMounted, onBeforeUnmount, ref, reactive, computed, watch, nextTick } from 'vue'
import { usePanzoomRegistry } from '../composables/usePanzoomRegistry.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import { getBoxes, getBoxReason, outlinesFor, driveFileId } from '../composables/useCurationData.js'
import { useWingOutlines } from '../composables/useWingOutlines.js'
import { useNearViewport } from '../composables/useNearViewport.js'
import { getProxiedUrl, notifyTierFailed, getProxyState, isHeicName, retryUrl } from '../utils/imageProxy.js'
import HeicPlaceholder from './HeicPlaceholder.vue'
import { unionBox, unionBoxScale } from '../utils/wingBoxes.js'
import PredictionPanel from './PredictionPanel.vue'
import { usePhotoLightbox } from '../composables/usePhotoLightbox.js'

const props = defineProps({
  item: Object,
  side: String
})

const { register, unregister } = usePanzoomRegistry()
const { showBoxes, zoomWings, showOutlines } = useGlobalGalleryOptions()

// Wing outlines: one small SVG per photo, only while the card is near the viewport.
const cardRef = ref(null)
const nearViewport = useNearViewport(cardRef)
const { outlinePhotos } = useWingOutlines()
const photoOutlines = computed(() => {
  const map = outlinePhotos.value
  if (!showOutlines.value || !nearViewport.value || !map) return []
  return displayPhotos().map(photo => outlinesFor(map, photo.Name, driveFileId(photo.URL_to_view)))
})
const outlinesOf = (index) => photoOutlines.value[index] || []

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

const resolvePhotoUrl = (url, name = '') => {
  void proxyVersion.value
  return getProxiedUrl(url, { name })
}

// HEIC photos that wsrv.nl could not convert, after one retry (a first conversion can time out):
// a placeholder with a link to the file on Drive
const failedHeic = reactive({})

const handleImgError = (e, originalUrl, name = '') => {
  const currentSrc = e.target.src
  if (isHeicName(name)) {   // only wsrv decodes HEIC: a failure is not a sign wsrv is blocked
    if (!e.target.dataset.retried) { e.target.dataset.retried = '1'; e.target.src = retryUrl(currentSrc) }
    else failedHeic[name] = true
    return
  }

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
    disablePan: true,
    cursor: 'zoom-in'   // a click opens the photo large (see enlarge)
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
      pz.setOptions({ disablePan: true, touchAction: 'pan-y', cursor: 'zoom-in' })
    }
  })

  // non-scaling-stroke ignores the layer's CSS transform: thin the overlay
  // strokes by the zoom so they stay ~1.5 px on screen.
  el.addEventListener('panzoomchange', (e) => {
    el.style.setProperty('--pz-scale', String(e.detail.scale || 1))
  })

  el.addEventListener('panzoomreset', () => {
    pz.setOptions({ disablePan: true, touchAction: 'pan-y', cursor: 'zoom-in' })
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
const ensureBoxes = async (index, photo) => {
  if (photoState[index] && photoState[index].loaded) return
  if (!photoState[index]) photoState[index] = { boxes: [], loaded: false }
  const name = photo.Name
  const [boxes, boxReason] = await Promise.all([getBoxes(name, 'current', driveFileId(photo.URL_to_view)), getBoxReason(name)])
  photoState[index] = { boxes, boxReason, loaded: true }
}

// Returns a promise that resolves once every visible photo's boxes are in
// photoState, so callers can `await` it before framing (avoids a race where
// framing runs before the boxes have loaded).
const loadVisibleBoxes = () => {
  const photos = displayPhotos()
  return Promise.all(photos.map((photo, index) => ensureBoxes(index, photo)))
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
  // The box is already padded (1.5 % of the photo's shorter side for the
  // Database Manager's boxes): frame it as is, filling the photo's frame.
  const u = unionBox(st.boxes, { padding: 0, aspect: null })
  if (!u) { pz.reset({ animate: false }); return }
  const W = el.offsetWidth, H = el.offsetHeight
  if (!W || !H) return
  const cx = (u.x1 + u.x2) / 2, cy = (u.y1 + u.y2) / 2
  const scale = unionBoxScale(u, 8, 1)
  pz.zoom(scale, { animate: false })
  // force: true — pan() is a no-op while disablePan is set (the panel's default),
  // which would frame off-centre wings on the image middle instead of the bbox.
  pz.pan(W * (0.5 - cx), H * (0.5 - cy), { animate: false, force: true })
  // we're zoomed in now, so allow dragging straight away (don't wait on the event)
  pz.setOptions({ disablePan: false, touchAction: 'none', cursor: 'move' })
}

const applyWingFramesAll = () => displayPhotos().forEach((_, i) => applyWingFrame(i))

// Photos that have arrived (by file name): until then the frame is a tinted 3:2 slot.
const loadedPhotos = reactive({})

// img onload: dimensions are now known, so (re)apply the wing frame if active.
const onImgLoad = (index, photo) => {
  if (photo) loadedPhotos[photo.Name] = true
  if (zoomWings.value) applyWingFrame(index)
}

const boxesFor = (index) => {
  const st = photoState[index]
  return st && st.loaded ? st.boxes : []
}

const boxReasonFor = (index) => {
  const st = photoState[index]
  return st && st.loaded ? st.boxReason : null
}

const fmtConf = (conf) => {
  if (typeof conf !== 'number' || Number.isNaN(conf)) return ''
  return `${Math.round(conf * 100)}%`
}

// --- Enlarge: a click or tap on a photo (not zoomed in, not dragged) or Enter/Space
// on it opens the lightbox with the image the card already shows.
const { openLightbox } = usePhotoLightbox()
let downAt = null
const onPointerDown = (e) => { downAt = { x: e.clientX, y: e.clientY } }
const viewName = (photo) => /d\d*\./i.test(photo.Name) ? 'dorsal' : /v\d*\./i.test(photo.Name) ? 'ventral' : ''
const photoCaption = (photo) => [props.item.CAM_ID, viewName(photo)].filter(Boolean).join(' ')
// The lightbox gets all of the card's photos (dorsal and ventral, whatever the Side
// option shows), so the arrow keys flip between them.
const enlarge = (index, photo) => {
  const shown = displayPhotos()
  const all = displayPhotos('Dorsal and Ventral')
  const photos = all.map(p => {
    const i = shown.findIndex(q => q.Name === p.Name)
    const img = i >= 0 ? imgRefs.value[i] : null
    return {
      src: img?.currentSrc || img?.src || resolvePhotoUrl(p.URL_to_view, p.Name),
      alt: `${photoCaption(p)}, large`,
      caption: photoCaption(p),
    }
  })
  openLightbox({ photos, index: Math.max(0, all.findIndex(p => p.Name === photo.Name)) })
}
const onPhotoClick = (e, index, photo) => {
  const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 0
  downAt = null
  const scale = pzInstances[index]?.getScale?.() ?? 1
  if (moved > 6 || scale > 1.05) return   // a drag or a zoomed-in photo keeps panning
  // panzoom's pointerdown keeps the photo from taking focus; give it focus so closing returns here
  e.currentTarget?.focus?.({ preventScroll: true })
  enlarge(index, photo)
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

const displayPhotos = (side = props.side) => {
  let list = []
  if (props.item.all_photos && props.item.all_photos.length > 0) {
    list = props.item.all_photos.filter(p => {
      const viewName = String(p.Name || '').toLowerCase()
      if (side === 'Dorsal' && !/[d]\d*\./.test(viewName)) return false
      if (side === 'Ventral' && !/[v]\d*\./.test(viewName)) return false
      return true
    })
  } else {
    if ((side.includes('Dorsal') || side === 'Dorsal and Ventral') && props.item.URLd) {
      list.push({ URL_to_view: props.item.URLd, Name: `${props.item.CAM_ID}d.JPG` })
    }
    if ((side.includes('Ventral') || side === 'Dorsal and Ventral') && props.item.URLv) {
      list.push({ URL_to_view: props.item.URLv, Name: `${props.item.CAM_ID}v.JPG` })
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
  <div ref="cardRef" class="gallery-card h-100 d-flex flex-column">
    <h5 class="fw-bold text-center mt-2">{{ item.CAM_ID }}</h5>

    <div class="photo-grid-container p-2">
       <div v-for="(photo, index) in displayPhotos()" :key="index" class="img-wrapper" :class="{ 'is-loading': !loadedPhotos[photo.Name] }"
         role="button" tabindex="0" :aria-label="`Enlarge photo: ${photoCaption(photo)}`"
         @pointerdown.capture="onPointerDown" @click="onPhotoClick($event, index, photo)"
         @keydown.enter.self.prevent="enlarge(index, photo)" @keydown.space.self.prevent="enlarge(index, photo)">
         <!-- zoom-layer holds img + overlay together so the SVG zooms WITH the image -->
         <!-- a HEIC photo that could not be converted: placeholder with a link to the file -->
         <HeicPlaceholder v-if="failedHeic[photo.Name]" :url="photo.URL_to_view" />
         <div
           v-else
           class="zoom-layer"
           :ref="el => layerRefs[index] = el"
         >
           <img
             :ref="el => imgRefs[index] = el"
             :src="resolvePhotoUrl(photo.URL_to_view, photo.Name)"
             class="panzoom-img"
             loading="lazy"
             referrerpolicy="no-referrer"
             :alt="photo.Name"
             @load="onImgLoad(index, photo)"
             @error="(e) => handleImgError(e, photo.URL_to_view, photo.Name)"
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

           <!-- Wing outlines: 0..1000 grid of the photo as displayed; the layer is the
                image's own box, so the grid is stretched onto it (preserveAspectRatio none) -->
           <svg
             v-if="outlinesOf(index).length"
             class="wing-overlay"
             viewBox="0 0 1000 1000"
             preserveAspectRatio="none"
             aria-hidden="true"
           >
             <path
               v-for="(w, wi) in outlinesOf(index)"
               :key="'o-' + wi"
               :d="w.d"
               :class="w.kind === 'fw' ? 'wing-outline-fw' : 'wing-outline-hw'"
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
           <div v-if="(showBoxes || zoomWings) && !boxesFor(index).length && boxReasonFor(index)?.reason" class="box-status small" role="status">
             {{ boxReasonFor(index).reason }}
           </div>
         </div>
       </div>
    </div>

    <div class="mt-2 text-start small wg-box p-2 rounded-bottom border-top">
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
  min-height: min(200px, 25vw);   /* phones: 200px left a blank band under ~110px photos */
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
/* while a photo streams in, its frame shows as a tinted slot of the usual 3:2 shape */
.img-wrapper.is-loading { aspect-ratio: 3 / 2; background: var(--wg-line); border-radius: 4px; }
/* phones: dorsal over ventral at the card's full width (about 340 px each at 390 px) */
@media (max-width: 575.98px) {
  .photo-grid-container { grid-template-columns: 1fr; padding: 0.25rem 0 !important; }
  .img-wrapper:only-child { grid-column: auto; }
}

/* The zoom-layer wraps img + overlay so panzoom transforms them together. */
.zoom-layer {
  position: relative;
  width: 100%;
  line-height: 0;
  cursor: zoom-in;
}

.panzoom-img {
  width: 100%;
  height: auto;
  object-fit: contain;
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
.wing-outline-fw, .wing-outline-hw {
  stroke-width: calc(1.5px / var(--pz-scale, 1));
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.wing-outline-fw { fill: rgba(255, 122, 0, 0.22); stroke: #ff7a00; }
.wing-outline-hw { fill: rgba(0, 170, 255, 0.22); stroke: #00aaff; }
.wing-rect {
  fill: none;
  stroke: #00e0ff;
  stroke-width: calc(2px / var(--pz-scale, 1));
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
.box-status {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 4px;
  padding: 2px 4px;
  line-height: 1.2;
  background: rgba(255, 255, 255, 0.88);
  color: #475569;   /* fixed: it sits on the photo, not on the themed card */
  border-radius: 3px;
  pointer-events: none;
}
</style>
