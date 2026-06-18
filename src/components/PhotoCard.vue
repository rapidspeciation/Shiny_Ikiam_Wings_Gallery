<script setup>
import Panzoom from '@panzoom/panzoom'
import { onMounted, onBeforeUnmount, ref, reactive, computed, watch, nextTick } from 'vue'
import { usePanzoomRegistry } from '../composables/usePanzoomRegistry.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import { getBoxes } from '../composables/useCurationData.js'
import { getProxiedUrl, notifyTierFailed, getProxyState } from '../utils/imageProxy.js'

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
const pzInstances = []   // parallels imgRefs by index (null while suspended)

const initZoom = (el) => {
  if (!el) return null

  const pz = Panzoom(el, {
    maxScale: 5,
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
  imgRefs.value.forEach((el, i) => {
    if (el && !pzInstances[i]) {
      pzInstances[i] = initZoom(el)
    }
  })
}

const detachPanzoomAll = () => {
  pzInstances.forEach((pz, i) => destroyPz(pz, imgRefs.value[i]))
  pzInstances.length = 0
}

// --- Wing-box loading (lazy, on first need per photo) ---
const ensureBoxes = async (index, name) => {
  if (photoState[index] && photoState[index].loaded) return
  if (!photoState[index]) photoState[index] = { boxes: [], loaded: false }
  const boxes = await getBoxes(name)
  photoState[index] = { boxes, loaded: true }
}

const loadVisibleBoxes = () => {
  const photos = displayPhotos()
  photos.forEach((photo, index) => ensureBoxes(index, photo.Name))
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

// CSS transform that frames the union bbox (transform-origin: 0 0).
const zoomTransform = (index) => {
  const st = photoState[index]
  if (!st || !st.loaded) return null
  const u = unionBox(st.boxes)
  if (!u) return null
  const w = u.x2 - u.x1
  const h = u.y2 - u.y1
  const scale = Math.min(5, 0.95 / Math.max(w, h))
  // translate so (x1,y1) maps to origin, then scale. Order: scale then translate
  // in percentages of the (untransformed) element box.
  return `scale(${scale}) translate(${(-u.x1 * 100).toFixed(4)}%, ${(-u.y1 * 100).toFixed(4)}%)`
}

const boxesFor = (index) => {
  const st = photoState[index]
  return st && st.loaded ? st.boxes : []
}

const fmtConf = (conf) => {
  if (typeof conf !== 'number' || Number.isNaN(conf)) return ''
  return `${Math.round(conf * 100)}%`
}

// --- Reactive orchestration --------------------------------------------

// When zoom-to-wings turns on, suspend panzoom + reset existing transforms,
// then apply CSS zoom. When off, restore panzoom.
watch(zoomWings, async (on) => {
  if (on) {
    // reset any panzoom transform before suspending so the layer is clean
    pzInstances.forEach(pz => pz && pz.reset({ animate: false }))
    detachPanzoomAll()
    await loadVisibleBoxes()
  } else {
    await nextTick()
    attachPanzoomAll()
  }
})

// Boxes are needed when overlays are on OR when zooming to wings.
watch([showBoxes, zoomWings], ([sb, zw]) => {
  if (sb || zw) loadVisibleBoxes()
})

onMounted(async () => {
  await nextTick()
  if (!zoomWings.value) attachPanzoomAll()
  if (showBoxes.value || zoomWings.value) {
    await loadVisibleBoxes()
    if (zoomWings.value) {
      // nothing else: transform binding reacts to photoState
    }
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

    <div class="photo-grid-container flex-grow-1 p-2">
       <div v-for="(photo, index) in displayPhotos()" :key="index" class="img-wrapper">
         <!-- zoom-layer holds img + overlay together so the SVG zooms WITH the image -->
         <div
           class="zoom-layer"
           :ref="el => layerRefs[index] = el"
           :class="{ 'is-wing-zoom': zoomWings && zoomTransform(index) }"
           :style="zoomWings && zoomTransform(index) ? { transform: zoomTransform(index) } : null"
         >
           <img
             :ref="el => imgRefs[index] = el"
             :src="resolvePhotoUrl(photo.URL_to_view)"
             class="panzoom-img"
             loading="lazy"
             referrerpolicy="no-referrer"
             :alt="photo.Name"
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
    </div>
  </div>
</template>

<style scoped>
.photo-grid-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-content: center;
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

/* The zoom-layer wraps img + overlay so wing-zoom transforms them together. */
.zoom-layer {
  position: relative;
  width: 100%;
  line-height: 0;
}
.zoom-layer.is-wing-zoom {
  transform-origin: 0 0;
  will-change: transform;
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
