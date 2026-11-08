<script setup>
// Small click-to-pin map for the AI Identifier's "Where taken?" row. Loaded as its
// own chunk (defineAsyncComponent in AILocationChips) so Leaflet and its CSS only
// download when someone opens the map. OpenStreetMap tiles with the attribution
// OSM requires; in the dark theme Esri's dark grey basemap with its attribution,
// switched live when the theme changes.
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  lat: { type: Number, default: null },
  lon: { type: Number, default: null },
})
const emit = defineEmits(['pick'])

const el = ref(null)
let map = null, marker = null, halo = null, tiles = null, themeObs = null

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
const TILES = {
  light: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: OSM_ATTR }],
  // Esri's Dark Gray Canvas (CARTO's dark_all now draws "API key required" over its tiles)
  dark: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, maxNativeZoom: 16,
    attribution: '&copy; <a href="https://www.esri.com" target="_blank" rel="noopener noreferrer">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors, and the GIS user community',
  }],
}
const isDark = () => document.documentElement.getAttribute('data-bs-theme') === 'dark'

function applyTheme() {
  if (!map) return
  const dark = isDark()
  const [url, opts] = TILES[dark ? 'dark' : 'light']
  if (tiles && tiles._url === url) return
  if (tiles) map.removeLayer(tiles)
  tiles = L.tileLayer(url, opts).addTo(map)
  halo?.setStyle({ opacity: dark ? 0.9 : 0 })
}

function place(lat, lon) {
  if (!map) return
  if (!marker) {
    // light ring under the pin, shown on the dark map
    halo = L.circleMarker([lat, lon], { radius: 10.5, color: '#fff', weight: 2, fill: false, interactive: false, opacity: isDark() ? 0.9 : 0 }).addTo(map)
    marker = L.circleMarker([lat, lon], { radius: 8, color: '#15803d', weight: 3, fillColor: '#22c55e', fillOpacity: 0.7 }).addTo(map)
  } else {
    marker.setLatLng([lat, lon])
    halo.setLatLng([lat, lon])
  }
}

onMounted(() => {
  const has = Number.isFinite(props.lat) && Number.isFinite(props.lon)
  map = L.map(el.value, { worldCopyJump: true, minZoom: 2 })
    .setView(has ? [props.lat, props.lon] : [-1.5, -70], has ? 7 : 3)
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>')
  applyTheme()
  themeObs = new MutationObserver(applyTheme)
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] })
  if (has) place(props.lat, props.lon)
  map.on('click', (e) => {
    const { lat } = e.latlng
    const lon = ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180   // wrap copies of the world
    place(lat, e.latlng.lng)
    emit('pick', { lat, lon })
  })
})
watch(() => [props.lat, props.lon], ([a, o]) => { if (Number.isFinite(a) && Number.isFinite(o)) place(a, o) })
onBeforeUnmount(() => { themeObs?.disconnect(); map?.remove(); map = null; marker = null; halo = null; tiles = null })
</script>

<template>
  <div ref="el" class="loc-map" role="application" aria-label="Map. Click where the photo was taken."></div>
</template>

<style scoped>
.loc-map { height: 260px; width: 100%; border-radius: .5rem; border: 1px solid var(--wg-line-strong); cursor: crosshair; }
</style>
