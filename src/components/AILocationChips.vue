<script setup>
// "Where taken?" chips for one AI Identifier result: Any, up to three suggested
// locations (from the photo's own prediction mass), and "Other country…" with
// country / side-of-Andes pickers. Location changes are emitted so the parent
// keeps the single rerank() path.
import { ref, computed, watch } from 'vue'
import FilterSelect from './FilterSelect.vue'

const props = defineProps({
  suggest: { type: Array, default: () => [] },     // suggestLocations() output
  country: { type: String, default: 'Any' },
  region: { type: String, default: null },
  countryOptions: { type: Array, default: () => ['Any'] },
  regionOptions: { type: Array, default: () => [] },
})
const emit = defineEmits(['any', 'suggest', 'set-country', 'set-region'])

const ANY = 'Any'
const hasLocation = computed(() => props.country !== ANY || !!props.region)
const sideOf = (r) => (r?.startsWith('West') ? 'West' : r?.startsWith('East') ? 'East' : '')
const suggestLabel = (s) => (s.side ? `${s.country}, ${s.side} of Andes` : s.country)
const isSuggestActive = (s) => props.country === s.country && sideOf(props.region) === s.side
const suggestActive = computed(() => props.suggest.some(isSuggestActive))
const otherActive = computed(() => hasLocation.value && !suggestActive.value)
const showOther = ref(false)
watch(otherActive, (on) => { if (on) showOther.value = true })
</script>

<template>
  <div class="where" role="group" aria-labelledby="where-lbl">
    <div id="where-lbl" class="col-title">Where taken?</div>
    <div class="chips">
      <button type="button" class="btn btn-sm loc-chip" :class="!hasLocation ? 'btn-success' : 'btn-outline-secondary'"
        :aria-pressed="!hasLocation" @click="emit('any')">Any</button>
      <button v-for="s in suggest" :key="s.country + s.side" type="button"
        class="btn btn-sm loc-chip" :class="isSuggestActive(s) ? 'btn-success' : 'btn-outline-secondary'"
        :aria-pressed="isSuggestActive(s)" @click="emit('suggest', s)">{{ suggestLabel(s) }}</button>
      <button type="button" class="btn btn-sm loc-chip" :class="otherActive ? 'btn-success' : 'btn-outline-secondary'"
        :aria-pressed="otherActive" :aria-expanded="showOther" @click="showOther = !showOther">
        {{ otherActive ? `Other: ${country}${sideOf(region) ? `, ${sideOf(region)}` : ''}` : 'Other country…' }}
      </button>
    </div>
    <div v-if="showOther" class="other-sel mt-2">
      <FilterSelect label="Country" :options="countryOptions" :model-value="country"
        placeholder="Any country" @update:model-value="(v) => emit('set-country', v || ANY)" />
      <div v-if="country === 'Ecuador'" class="mt-2">
        <FilterSelect label="Side of the Andes" :options="regionOptions" :model-value="region"
          placeholder="Either side" @update:model-value="(v) => emit('set-region', v)" />
      </div>
    </div>
    <div class="hint text-muted">Pick where the photo was taken to favour species recorded there.</div>
  </div>
</template>

<style scoped>
.col-title { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #64748b; margin-bottom: .35rem; }
.chips { display: flex; flex-wrap: wrap; gap: .35rem; }
.loc-chip { --bs-btn-padding-y: .2rem; --bs-btn-padding-x: .6rem; --bs-btn-font-size: .78rem; border-radius: 999px; }
.hint { font-size: .72rem; margin-top: .35rem; }
.other-sel { max-width: 360px; }
</style>
