<script setup>
import Panzoom from '@panzoom/panzoom'
import { onMounted, onBeforeUnmount, ref, nextTick } from 'vue'
import { usePanzoomRegistry } from '../composables/usePanzoomRegistry.js'

const props = defineProps({
  item: Object,
  side: String // 'Dorsal', 'Ventral', or 'Dorsal and Ventral'
})

const { register, unregister, zoomAll } = usePanzoomRegistry()
const imgRefs = ref([]) // Array to store multiple image refs

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
  await nextTick() // Wait for v-for to render
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

// Helper to decide which photos to show
const displayPhotos = () => {
  // If specific 'all_photos' list exists (CRISPR/Insectary new logic)
  if (props.item.all_photos && props.item.all_photos.length > 0) {
    // For Collection tab, we might still want to respect the "side" filter loosely
    // But for CRISPR, we usually want to show everything. 
    // Let's filter based on the 'side' prop if it looks like a standard D/V photo.
    
    return props.item.all_photos.filter(p => {
      // If side is strict Dorsal, only show matching names
      if (props.side === 'Dorsal' && !p.Name.includes('d.JPG')) return false
      if (props.side === 'Ventral' && !p.Name.includes('v.JPG')) return false
      return true
    })
  }
  
  // Fallback for legacy objects
  const list = []
  if ((props.side.includes('Dorsal') || props.side === 'Dorsal and Ventral') && props.item.URLd) {
    list.push({ URL_to_view: props.item.URLd, Name: 'Dorsal' })
  }
  if ((props.side.includes('Ventral') || props.side === 'Dorsal and Ventral') && props.item.URLv) {
    list.push({ URL_to_view: props.item.URLv, Name: 'Ventral' })
  }
  return list
}
</script>

<template>
  <div class="gallery-card h-100 border rounded bg-white d-flex flex-column">
    <h5 class="fw-bold text-center mt-2">{{ item.CAM_ID }}</h5>
    
    <!-- Images Area -->
    <div class="d-flex flex-wrap justify-content-center align-items-center flex-grow-1 gap-2 px-2 py-2" style="min-height: 200px;">
       <div v-for="(photo, index) in displayPhotos()" :key="index" class="img-container flex-fill">
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
.img-container {
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 45%; /* Ensure images don't get too tiny */
  max-width: 100%;
}
.panzoom-img {
  width: 100%;
  height: auto;
  object-fit: contain;
  cursor: grab;
}
</style>