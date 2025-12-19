<script setup>
import { ref, computed, onMounted } from 'vue'
import { useDataset } from '../composables/useDataset.js'
import { useGallery } from '../composables/useGallery.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import FilterSelect from './FilterSelect.vue'
import PhotoGrid from './PhotoGrid.vue'

const { data: rawData, loading, error, ensureLoaded } = useDataset('crispr', './data/crispr.json')

const { columns, sortBy, sortOrder, side, onlyPhotos, onePerSubspecies } = useGlobalGalleryOptions()

const {
  isFiltered, allMatches, paginatedData, hasMore, loadMore, applyFilters
} = useGallery(rawData, { sortBy, sortOrder, side, onlyPhotos, onePerSubspecies })

const filters = ref({
  species: [],
  sex: 'male and female',
  mutant: 'All'
})

const getUnique = (field, data) => Array.from(new Set(data.map(i => i[field]).filter(x => x && x !== "NA"))).sort()

const speciesList = computed(() => getUnique('Species', rawData.value))

onMounted(async () => {
  await ensureLoaded()
})

const onShowPhotos = () => {
  applyFilters((item) => {
    if (filters.value.species.length > 0 && !filters.value.species.includes(item.Species)) return false
    if (filters.value.sex !== 'male and female' && item.Sex !== filters.value.sex) return false
    if (filters.value.mutant !== 'All' && filters.value.mutant !== 'Check') {
      if (item.Mutant !== filters.value.mutant) return false
    }
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
      <div class="col-6 col-md-3">
         <label class="form-label small fw-bold">Sex</label>
         <select class="form-select" v-model="filters.sex">
           <option>male and female</option>
           <option>male</option>
           <option>female</option>
         </select>
      </div>
      <div class="col-6 col-md-3">
         <label class="form-label small fw-bold">Mutant</label>
         <select class="form-select" v-model="filters.mutant">
           <option>All</option>
           <option>Yes</option>
           <option>No</option>
           <option>Check</option>
           <option>NA</option>
         </select>
      </div>
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
