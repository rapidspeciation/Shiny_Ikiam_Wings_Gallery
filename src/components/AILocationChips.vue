<script setup>
// "Where taken?" for one AI Identifier result. Sources of a location, per photo:
// GPS from the photo's EXIF (applied automatically, "Don't use" turns it off), a
// map pin, a suggested country or Ecuador region (from the photo's own
// predictions; applied only when tapped), or any country under "Other country…".
// Ecuador can be narrowed to Costa / Sierra / Oriente / Galapagos. Changes are
// emitted so the parent keeps the single rerank() path.
import { ref, computed, watch, defineAsyncComponent } from 'vue'
import FilterSelect from './FilterSelect.vue'
import { countryName } from '../utils/geoPrior.js'
import { EC_REGIONS, EC_REGION_HINT, fmtLatLon } from '../utils/geoSpatial.js'

const LocationMap = defineAsyncComponent(() => import('./LocationMap.vue'))

const props = defineProps({
  loc: { type: Object, default: null },           // null | { mode: 'coords'|'country'|'region', ... }
  exifGps: { type: Object, default: null },       // { lat, lon } read from the photo, or null
  suggest: { type: Array, default: () => [] },    // [{ kind: 'country', iso } | { kind: 'region', region }]
  countryOptions: { type: Array, default: () => ['Any'] },
  status: { type: String, default: '' },          // '' | 'loading' | message
})
const emit = defineEmits(['any', 'suggest', 'set-country', 'set-region', 'use-exif', 'set-pin'])

const ANY = 'Any'
const mode = computed(() => props.loc?.mode || '')
const fmt = (p) => (p ? fmtLatLon(p.lat, p.lon) : '')
const exifActive = computed(() => mode.value === 'coords' && props.loc.source === 'exif')
const pinActive = computed(() => mode.value === 'coords' && props.loc.source === 'map')
const ecuadorActive = computed(() => (mode.value === 'country' && props.loc.iso === 'EC') || mode.value === 'region')

const suggestLabel = (s) => (s.kind === 'region' ? `Ecuador, ${s.region}` : countryName(s.iso))
const isSuggestActive = (s) => (s.kind === 'region'
  ? mode.value === 'region' && props.loc.region === s.region
  : mode.value === 'country' && props.loc.iso === s.iso)
const suggestActive = computed(() => props.suggest.some(isSuggestActive))
const otherActive = computed(() => (mode.value === 'country' || mode.value === 'region') && !suggestActive.value)
const selectedCountry = computed(() => (mode.value === 'region' ? countryName('EC') : mode.value === 'country' ? countryName(props.loc.iso) : ANY))
const otherLabel = computed(() => (mode.value === 'region' ? `Other: Ecuador, ${props.loc.region}` : `Other: ${selectedCountry.value}`))

const showOther = ref(false)
const showMap = ref(false)
watch(otherActive, (on) => { if (on) showOther.value = true })

const hint = computed(() => {
  if (mode.value === 'coords') return 'Favours species with GBIF records within about 100 km.'
  if (mode.value === 'region') return 'Favours species with GBIF records in this region.'
  if (mode.value === 'country') return 'Favours species with GBIF records in this country.'
  return 'Pick where the photo was taken to favour species recorded there.'
})
function pick(p) { emit('set-pin', p) }
</script>

<template>
  <div class="where" role="group" aria-labelledby="where-lbl">
    <div id="where-lbl" class="col-title">Where taken?</div>
    <div v-if="exifGps" class="exif-row">
      <template v-if="exifActive">
        Location from photo: <strong>{{ fmt(exifGps) }}</strong>
        <button type="button" class="btn btn-link btn-sm p-0 ms-1 align-baseline" @click="emit('any')">Don't use</button>
      </template>
      <template v-else>
        Photo has a location ({{ fmt(exifGps) }}).
        <button type="button" class="btn btn-link btn-sm p-0 ms-1 align-baseline" @click="emit('use-exif')">Use it</button>
      </template>
    </div>
    <div class="chips">
      <button type="button" class="btn btn-sm loc-chip" :class="!loc ? 'btn-success' : 'btn-outline-secondary'"
        :aria-pressed="!loc" @click="emit('any')">Any</button>
      <button v-for="s in suggest" :key="s.kind + (s.iso || s.region)" type="button"
        class="btn btn-sm loc-chip" :class="isSuggestActive(s) ? 'btn-success' : 'btn-outline-secondary'"
        :aria-pressed="isSuggestActive(s)" @click="emit('suggest', s)">{{ suggestLabel(s) }}</button>
      <button type="button" class="btn btn-sm loc-chip" :class="pinActive ? 'btn-success' : 'btn-outline-secondary'"
        :aria-pressed="pinActive" :aria-expanded="showMap" @click="showMap = !showMap">
        {{ pinActive ? `Map: ${fmt(loc)}` : 'Pick on map' }}
      </button>
      <button type="button" class="btn btn-sm loc-chip" :class="otherActive ? 'btn-success' : 'btn-outline-secondary'"
        :aria-pressed="otherActive" :aria-expanded="showOther" @click="showOther = !showOther">
        {{ otherActive ? otherLabel : 'Other country…' }}
      </button>
    </div>
    <div v-if="showMap" class="map-box mt-2">
      <LocationMap :lat="mode === 'coords' ? loc.lat : null" :lon="mode === 'coords' ? loc.lon : null" @pick="pick" />
      <div class="hint">Click where the photo was taken.<template v-if="pinActive"> Pin: {{ fmt(loc) }}</template></div>
    </div>
    <div v-if="showOther" class="other-sel mt-2">
      <FilterSelect label="Country" :options="countryOptions" :model-value="selectedCountry"
        placeholder="Any country" @update:model-value="(v) => (v && v !== ANY ? emit('set-country', v) : emit('any'))" />
    </div>
    <div v-if="ecuadorActive" class="region-row mt-2" role="group" aria-label="Region in Ecuador">
      <span class="sub-lbl">Region in Ecuador</span>
      <div class="chips">
        <button type="button" class="btn btn-sm loc-chip" :class="mode === 'country' ? 'btn-success' : 'btn-outline-secondary'"
          :aria-pressed="mode === 'country'" @click="emit('set-region', null)">Whole country</button>
        <button v-for="r in EC_REGIONS" :key="r" type="button" class="btn btn-sm loc-chip" :title="EC_REGION_HINT[r]"
          :class="mode === 'region' && loc.region === r ? 'btn-success' : 'btn-outline-secondary'"
          :aria-pressed="mode === 'region' && loc.region === r" @click="emit('set-region', r)">{{ r }}</button>
      </div>
      <div class="hint">Sierra: Andes, 1,500 m and above. Oriente: Amazon.</div>
    </div>
    <div class="hint text-muted">
      <template v-if="status === 'loading'">Loading location data…</template>
      <template v-else-if="status">{{ status }}</template>
      <template v-else>{{ hint }}</template>
    </div>
  </div>
</template>

<style scoped>
.col-title { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #64748b; margin-bottom: .35rem; }
.chips { display: flex; flex-wrap: wrap; gap: .35rem; }
.loc-chip { --bs-btn-padding-y: .2rem; --bs-btn-padding-x: .6rem; --bs-btn-font-size: .78rem; border-radius: 999px; }
.hint { font-size: .72rem; margin-top: .35rem; color: #64748b; }
.other-sel { max-width: 360px; }
.map-box { max-width: 520px; }
.exif-row { font-size: .8rem; margin-bottom: .4rem; }
.exif-row .btn-link { font-size: .8rem; }
.sub-lbl { display: block; font-size: .72rem; font-weight: 600; color: #475569; margin-bottom: .25rem; }
</style>
