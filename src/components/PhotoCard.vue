<script setup>
import Panzoom from '@panzoom/panzoom'
import { onMounted, ref } from 'vue'

const props = defineProps({
  item: Object,
  side: String // 'Dorsal', 'Ventral', or 'Dorsal and Ventral'
})

// Refs for the images
const imgD = ref(null)
const imgV = ref(null)

const initZoom = (el) => {
  if (!el) return

  // Initialize Panzoom
  const pz = Panzoom(el, { maxScale: 5, minScale: 0.5 })

  // Add Wheel Listener (Ctrl+Scroll to zoom)
  el.parentElement.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault()
      pz.zoomWithWheel(e)
    }
  })
}

onMounted(() => {
  if (imgD.value) initZoom(imgD.value)
  if (imgV.value) initZoom(imgV.value)
})
</script>

<template>
  <div class="gallery-card h-100 border rounded bg-white d-flex flex-column">
    <h5 class="fw-bold text-center mt-2">CAM ID: {{ item.CAM_ID }}</h5>

    <!-- Images Area (Flex grow to push footer down) -->
    <div class="d-flex justify-content-center align-items-center flex-grow-1" style="min-height: 200px; overflow: hidden;">
       <!-- Dorsal -->
       <div v-if="(side.includes('Dorsal') || side === 'Dorsal and Ventral') && item.URLd" class="img-container me-1">
         <img ref="imgD" :src="item.URLd" class="panzoom-img" loading="lazy" alt="Dorsal">
       </div>

       <!-- Ventral -->
       <div v-if="(side.includes('Ventral') || side === 'Dorsal and Ventral') && item.URLv" class="img-container ms-1">
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
  max-width: 50%;
}
.panzoom-img {
  max-width: 100%;
  height: auto;
  cursor: grab;
}
</style>
