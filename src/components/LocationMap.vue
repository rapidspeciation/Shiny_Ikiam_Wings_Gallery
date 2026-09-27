<script setup>
// Small click-to-pin map for the AI Identifier's "Where taken?" row. Loaded as its
// own chunk (defineAsyncComponent in AILocationChips) so Leaflet and its CSS only
// download when someone opens the map. OpenStreetMap tiles with the attribution
// OSM requires.
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  lat: { type: Number, default: null },
  lon: { type: Number, default: null },
})
const emit = defineEmits(['pick'])

const el = ref(null)
let map = null, marker = null

function place(lat, lon) {
  if (!map) return
  if (!marker) marker = L.circleMarker([lat, lon], { radius: 8, color: '#15803d', weight: 3, fillColor: '#22c55e', fillOpacity: 0.7 }).addTo(map)
  else marker.setLatLng([lat, lon])
}

onMounted(() => {
  const has = Number.isFinite(props.lat) && Number.isFinite(props.lon)
  map = L.map(el.value, { worldCopyJump: true, minZoom: 2 })
    .setView(has ? [props.lat, props.lon] : [-1.5, -70], has ? 7 : 3)
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>')
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  }).addTo(map)
  if (has) place(props.lat, props.lon)
  map.on('click', (e) => {
    const { lat } = e.latlng
    const lon = ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180   // wrap copies of the world
    place(lat, e.latlng.lng)
    emit('pick', { lat, lon })
  })
})
watch(() => [props.lat, props.lon], ([a, o]) => { if (Number.isFinite(a) && Number.isFinite(o)) place(a, o) })
onBeforeUnmount(() => { map?.remove(); map = null; marker = null })
</script>

<template>
  <div ref="el" class="loc-map" role="application" aria-label="Map. Click where the photo was taken."></div>
</template>

<style scoped>
.loc-map { height: 260px; width: 100%; border-radius: .5rem; border: 1px solid #cbd5e1; cursor: crosshair; }
</style>
