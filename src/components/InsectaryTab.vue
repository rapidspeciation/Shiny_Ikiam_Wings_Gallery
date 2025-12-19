<script setup>
import { ref, computed, onMounted } from 'vue'
import { useDataset } from '../composables/useDataset.js'
import { useGallery } from '../composables/useGallery.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import FilterSelect from './FilterSelect.vue'
import PhotoGrid from './PhotoGrid.vue'

const { data: rawData, loading, error, ensureLoaded } = useDataset('insectary', './data/insectary.json')

const { columns, sortBy, sortOrder, side, onlyPhotos, onePerSubspecies } = useGlobalGalleryOptions()

const {
  isFiltered, allMatches, paginatedData, hasMore, loadMore, applyFilters
} = useGallery(rawData, { sortBy, sortOrder, side, onlyPhotos, onePerSubspecies })

const filters = ref({
  species: [],
  subspecies: [],
  sex: 'male and female',
  insectaryId: null // Single select for ID usually, or search
})

// Helpers
const getUnique = (field, data) => Array.from(new Set(data.map(i => i[field]).filter(x => x && x !== "NA"))).sort()

// Options
const speciesList = computed(() => getUnique('Species', rawData.value))

const subspeciesList = computed(() => {
  let data = rawData.value
  if (filters.value.species.length > 0) data = data.filter(i => filters.value.species.includes(i.Species))
  return getUnique('Subspecies_Form', data)
})

const idList = computed(() => {
  let data = rawData.value
  if (filters.value.species.length > 0) data = data.filter(i => filters.value.species.includes(i.Species))
  if (filters.value.subspecies.length > 0) data = data.filter(i => filters.value.subspecies.includes(i.Subspecies_Form))
  return getUnique('Insectary_ID', data)
})

onMounted(async () => {
  await ensureLoaded()
})

const onShowPhotos = () => {
  applyFilters((item) => {
    if (filters.value.species.length > 0 && !filters.value.species.includes(item.Species)) return false
    if (filters.value.subspecies.length > 0 && !filters.value.subspecies.includes(item.Subspecies_Form)) return false
    if (filters.value.sex !== 'male and female' && item.Sex !== filters.value.sex) return false
    if (filters.value.insectaryId && item.Insectary_ID !== filters.value.insectaryId) return false
    return true
  })
}
</script>

<template>
  <div>
    <!-- Filters -->
    <!-- Updated classes to col-6 col-md-3 -->
    <div class="row g-3 mb-4">
      <div class="col-6 col-md-3"><FilterSelect label="Species" v-model="filters.species" :options="speciesList" :multiple="true" /></div>
      <div class="col-6 col-md-3"><FilterSelect label="Subspecies" v-model="filters.subspecies" :options="subspeciesList" :multiple="true" /></div>
      <div class="col-6 col-md-3">
         <label class="form-label small fw-bold">Sex</label>
         <select class="form-select" v-model="filters.sex">
           <option>male and female</option>
           <option>male</option>
           <option>female</option>
         </select>
      </div>
      <div class="col-6 col-md-3"><FilterSelect label="Insectary ID" v-model="filters.insectaryId" :options="idList" placeholder="All" /></div>
    </div>

    <div class="mb-4 text-center">
      <button class="btn btn-primary px-5 fw-bold" @click="onShowPhotos">Show Photos</button>
    </div>

    <PhotoGrid
      :loading="loading" :error="error" :isFiltered="isFiltered"
      :items="paginatedData" :totalCount="allMatches.length" :hasMore="hasMore"
      :side="side" :columns="columns" @loadMore="loadMore"
    />
  </div>
</template>
