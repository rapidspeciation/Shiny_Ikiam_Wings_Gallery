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

const initZoom = (el) => {
  if (!el) return null
  const pz = Panzoom(el, { maxScale: 5, minScale: 0.5 })
  register(pz)
  el.parentElement.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault()
      pz.zoomWithWheel(e)
    }
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

// Logic to Get AND Sort photos
const displayPhotos = () => {
  let list = []

  // A. New Logic (List based)
  if (props.item.all_photos && props.item.all_photos.length > 0) {
    list = props.item.all_photos.filter(p => {
      if (props.side === 'Dorsal' && !p.Name.includes('d.JPG')) return false
      if (props.side === 'Ventral' && !p.Name.includes('v.JPG')) return false
      return true
    })
  } 
  // B. Legacy Fallback
  else {
    if ((props.side.includes('Dorsal') || props.side === 'Dorsal and Ventral') && props.item.URLd) {
      list.push({ URL_to_view: props.item.URLd, Name: 'Dorsal' })
    }
    if ((props.side.includes('Ventral') || props.side === 'Dorsal and Ventral') && props.item.URLv) {
      list.push({ URL_to_view: props.item.URLv, Name: 'Ventral' })
    }
  }

  // C. Sort: Dorsal first, Ventral second, others later
  return list.sort((a, b) => {
    const nameA = a.Name.toLowerCase()
    const nameB = b.Name.toLowerCase()
    
    // Check for standard endings
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
    
    <!-- Images Area -->
    <div class="photo-grid-container flex-grow-1 p-2">
       <div v-for="(photo, index) in displayPhotos()" :key="index" class="img-wrapper">
         <img 
           :ref="el => imgRefs[index] = el" 
           :src="photo.URL_to_view" 
           class="panzoom-img" 
           loading="lazy" 
           :alt="photo.Name"
         >
       </div>
    </div>

    <!-- Metadata Footer -->
    <div class="mt-2 text-start small bg-light p-2 rounded-bottom border-top">
      <div class="row g-1">
        <div class="col-12"><strong>Species:</strong> {{ item.Species }}</div>
        <div class="col-12" v-if="item.Subspecies_Form && item.Subspecies_Form !== 'None'">
            <strong>Subsp:</strong> {{ item.Subspecies_Form }}
        </div>
        <div class="col-6"><strong>Sex:</strong> {{ item.Sex }}</div>
        <div class="col-6 text-end">{{ item.Preservation_date_formatted }}</div>
        <div class="col-12" v-if="item.Insectary_ID"><strong>Ins. ID:</strong> {{ item.Insectary_ID }}</div>
        <div class="col-12" v-if="item.Mutant && item.Mutant !== 'NA'"><strong>Mutant:</strong> {{ item.Mutant }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Enforce 2 columns, centered images */
.photo-grid-container {
  display: grid;
  grid-template-columns: 1fr 1fr; /* Exact 2 columns */
  gap: 8px;
  align-content: center; /* Vertically center content block */
  min-height: 200px;
}

.img-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  width: 100%;
  /* Optional: Add max-height to keep cards uniform, or remove to let them grow */
}

/* 
   Special Case: If there is only 1 photo, verify if we want it centered 
   spanning 2 columns or just on the left.
   The :only-child pseudo-class makes single photos bigger/centered.
*/
.img-wrapper:only-child {
  grid-column: span 2;
}

.panzoom-img {
  width: 100%;
  height: auto;
  object-fit: contain;
  cursor: grab;
}
</style>