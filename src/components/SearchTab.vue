<script setup>
import { ref, onMounted, computed } from 'vue'
import { useDataset } from '../composables/useDataset.js'
import { useGlobalGalleryOptions } from '../composables/useGlobalGalleryOptions.js'
import { applyGlobalPipeline } from '../utils/galleryPipeline.js'
import PhotoGrid from './PhotoGrid.vue'

// State
const inputIds = ref('')
const hasSearched = ref(false)

const { columns, side, sortBy, sortOrder, onlyPhotos, onePerSubspecies } = useGlobalGalleryOptions()

const {
  data: collectionData,
  loading: collectionLoading,
  error: collectionError,
  ensureLoaded: ensureCollectionLoaded
} = useDataset('collection', './data/collection.json')
const {
  data: crisprData,
  loading: crisprLoading,
  error: crisprError,
  ensureLoaded: ensureCrisprLoaded
} = useDataset('crispr', './data/crispr.json')
const {
  data: insectaryData,
  loading: insectaryLoading,
  error: insectaryError,
  ensureLoaded: ensureInsectaryLoaded
} = useDataset('insectary', './data/insectary.json')

const loading = computed(() => (
  collectionLoading.value || crisprLoading.value || insectaryLoading.value
))

// Data storage
const datasets = {
  Collection: collectionData,
  CRISPR: crisprData,
  Insectary: insectaryData
}

// Results storage
const results = ref({
  Collection: [],
  CRISPR: [],
  Insectary: []
})

// Load all data on mount
onMounted(async () => {
  await Promise.all([ensureCollectionLoaded(), ensureCrisprLoaded(), ensureInsectaryLoaded()])
})

const performSearch = () => {
  // Parse input: split by commas, spaces, newlines and remove empty
  const targets = inputIds.value
    .split(/[\s,]+/)
    .map(value => value.trim().toUpperCase())
    .filter(Boolean)
  
  if (targets.length === 0) return
  const uniqueTargets = new Set(targets)

  // Reset results
  results.value.Collection = []
  results.value.CRISPR = []
  results.value.Insectary = []

  // Search function
  const searchIn = (data) => data.filter(item => uniqueTargets.has(item.CAM_ID))

  results.value.Collection = searchIn(datasets.Collection.value)
  results.value.CRISPR = searchIn(datasets.CRISPR.value)
  results.value.Insectary = searchIn(datasets.Insectary.value)

  hasSearched.value = true
}

const displayResults = computed(() => {
  const options = {
    sortBy: sortBy.value,
    sortOrder: sortOrder.value,
    onlyPhotos: onlyPhotos.value,
    onePerSubspecies: onePerSubspecies.value
  }

  return {
    Collection: applyGlobalPipeline(results.value.Collection, options),
    CRISPR: applyGlobalPipeline(results.value.CRISPR, options),
    Insectary: applyGlobalPipeline(results.value.Insectary, options)
  }
})
</script>

<template>
  <div class="container">
    <div class="row justify-content-center mb-4">
      <div class="col-md-8">
        <label class="form-label fw-bold">Enter CAMID(s)</label>
        <textarea 
          class="form-control mb-3" 
          v-model="inputIds" 
          rows="3" 
          placeholder="Enter one or more CAMIDs (e.g. CAM01234), separated by spaces or new lines"
        ></textarea>
        <button class="btn btn-primary w-100" @click="performSearch" :disabled="loading">
          Search
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-center">Loading Data...</div>
    <div v-if="collectionError || crisprError || insectaryError" class="text-center text-danger">
      Error loading search data.
    </div>

    <div v-if="hasSearched && !loading">
      
      <!-- Collection Results -->
      <div v-if="displayResults.Collection.length > 0" class="mb-5">
        <h4 class="border-bottom pb-2">Collection Results ({{ displayResults.Collection.length }})</h4>
        <PhotoGrid 
          :loading="false" :isFiltered="true" :items="displayResults.Collection" 
          :totalCount="displayResults.Collection.length" :hasMore="false" 
          :side="side" :columns="columns" 
        />
      </div>

      <!-- CRISPR Results -->
      <div v-if="displayResults.CRISPR.length > 0" class="mb-5">
        <h4 class="border-bottom pb-2">CRISPR Results ({{ displayResults.CRISPR.length }})</h4>
        <PhotoGrid 
          :loading="false" :isFiltered="true" :items="displayResults.CRISPR" 
          :totalCount="displayResults.CRISPR.length" :hasMore="false" 
          :side="side" :columns="columns" 
        />
      </div>

      <!-- Insectary Results -->
      <div v-if="displayResults.Insectary.length > 0" class="mb-5">
        <h4 class="border-bottom pb-2">Insectary Results ({{ displayResults.Insectary.length }})</h4>
        <PhotoGrid 
          :loading="false" :isFiltered="true" :items="displayResults.Insectary" 
          :totalCount="displayResults.Insectary.length" :hasMore="false" 
          :side="side" :columns="columns" 
        />
      </div>

      <!-- No Results -->
      <div v-if="displayResults.Collection.length === 0 && displayResults.CRISPR.length === 0 && displayResults.Insectary.length === 0" class="text-center text-muted mt-5">
        No results found for these IDs.
      </div>

    </div>
  </div>
</template>
