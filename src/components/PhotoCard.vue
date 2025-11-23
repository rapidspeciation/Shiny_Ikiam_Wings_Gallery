<script setup>
import Panzoom from '@panzoom/panzoom'
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { usePanzoomRegistry } from '../composables/usePanzoomRegistry.js'

const props = defineProps({
  item: Object,
  side: String // 'Dorsal', 'Ventral', or 'Dorsal and Ventral'
})

const { register, unregister, zoomAll } = usePanzoomRegistry()

// Refs
const imgD = ref(null)
const imgV = ref(null)
let pzD = null
let pzV = null

const initZoom = (el) => {
  if (!el) return null

  const pz = Panzoom(el, { maxScale: 5, minScale: 0.5 })

  // Register globally
  register(pz)

  // Attach Listener to the PARENT container
  el.parentElement.addEventListener('wheel', (e) => {
    // Only handle Ctrl (Zoom One) locally.
    // Shift (Zoom All) is now handled globally in App.vue
    if (e.ctrlKey) {
      e.preventDefault()
      pz.zoomWithWheel(e)
    }
  })

  return pz
}

onMounted(() => {
  if (imgD.value) pzD = initZoom(imgD.value)
  if (imgV.value) pzV = initZoom(imgV.value)
})

onBeforeUnmount(() => {
  if (pzD) { pzD.destroy(); unregister(pzD) }
  if (pzV) { pzV.destroy(); unregister(pzV) }
})
</script>

<template>
  <div class="gallery-card h-100 border rounded bg-white d-flex flex-column">
    <h5 class="fw-bold text-center mt-2">CAM ID: {{ item.CAM_ID }}</h5>

    <!-- Images Area -->
    <!-- 'gap-2' adds space between images if both are shown -->
    <div class="d-flex justify-content-center align-items-center flex-grow-1 gap-2 px-2" style="min-height: 200px; overflow: hidden;">

       <!-- Dorsal -->
       <!-- 'flex-fill' makes it expand to fill space. 'mw-100' ensures it doesn't overflow container -->
       <div v-if="(side.includes('Dorsal') || side === 'Dorsal and Ventral') && item.URLd" class="img-container flex-fill">
         <img ref="imgD" :src="item.URLd" class="panzoom-img" loading="lazy" alt="Dorsal">
       </div>

       <!-- Ventral -->
       <div v-if="(side.includes('Ventral') || side === 'Dorsal and Ventral') && item.URLv" class="img-container flex-fill">
         <img ref="imgV" :src="item.URLv" class="panzoom-img" loading="lazy" alt="Ventral">
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
  /* Ensure container doesn't exceed parent width but allows shrinking */
  min-width: 0;
}
.panzoom-img {
  width: 100%;       /* Force image to take container width */
  height: auto;      /* Maintain aspect ratio */
  object-fit: contain; /* Ensure entire butterfly is visible */
  cursor: grab;
}
</style>
