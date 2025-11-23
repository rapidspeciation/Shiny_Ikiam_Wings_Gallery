<script setup>
import Panzoom from '@panzoom/panzoom'
import { onMounted, onBeforeUnmount, ref, nextTick } from 'vue'
import { usePanzoomRegistry } from '../composables/usePanzoomRegistry.js'

const props = defineProps({
  item: Object,
  side: String 
})

const { register, unregister } = usePanzoomRegistry()
const imgRefs = ref([]) 

// --- IMAGE PROXY LOGIC ---
const getProxiedUrl = (originalUrl) => {
  if (!originalUrl) return ''
  const encoded = encodeURIComponent(originalUrl)
  return `https://wsrv.nl/?url=${encoded}&w=800&q=80&output=webp`
}

const handleImgError = (e, originalUrl) => {
  if (e.target.src !== originalUrl) {
    e.target.src = originalUrl
  }
}
// -------------------------

const initZoom = (el) => {
  if (!el) return null
  
  // 1. Initialize Panzoom
  // disablePan: true -> Prevents the "slight movement" when scrolling the page.
  const pz = Panzoom(el, { 
    maxScale: 5, 
    minScale: 0.5,
    touchAction: 'pan-y',
    disablePan: true 
  })

  register(pz)

  // 2. Add Wheel Listener (Desktop)
  el.parentElement.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault()
      pz.zoomWithWheel(e)
    }
  })

  // 3. Dynamic Behavior: Unlock Pan ONLY when zoomed in
  el.addEventListener('panzoomzoom', (e) => {
    const currentScale = e.detail.scale
    
    // We use a small buffer (1.05) to account for floating point math
    if (currentScale > 1.05) {
      // Zoomed IN: Unlock Panning, Lock Page Scroll
      pz.setOptions({ disablePan: false, touchAction: 'none', cursor: 'move' })
    } else {
      // Zoomed OUT: Lock Panning (Fixes jitter), Allow Page Scroll
      pz.setOptions({ disablePan: true, touchAction: 'pan-y', cursor: 'grab' })
    }
  })
  
  // 4. Ensure Pan is disabled on Reset (when zooming out completely)
  el.addEventListener('panzoomreset', () => {
    pz.setOptions({ disablePan: true, touchAction: 'pan-y', cursor: 'grab' })
  })

  return pz
}

const pzInstances = []

onMounted(async () => {
  await nextTick()
  imgRefs.value.forEach(el => {
    if (el) pzInstances.push(initZoom(el))
  })
})

onBeforeUnmount(() => {
  pzInstances.forEach(pz => {
    pz.destroy()
    unregister(pz)
  })
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
         <img 
           :ref="el => imgRefs[index] = el" 
           :src="getProxiedUrl(photo.URL_to_view)" 
           class="panzoom-img" 
           loading="lazy" 
           :alt="photo.Name"
           @error="(e) => handleImgError(e, photo.URL_to_view)"
         >
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
}
.img-wrapper:only-child { grid-column: span 2; }
.panzoom-img {
  width: 100%;
  height: auto;
  object-fit: contain;
  cursor: grab;
}
</style>