<script setup>
import { ref, onMounted } from 'vue'
import PhotoGrid from './PhotoGrid.vue'

// State
const inputIds = ref('')
const loading = ref(true)
const hasSearched = ref(false)

// Data storage
const datasets = {
  Collection: ref([]),
  CRISPR: ref([]),
  Insectary: ref([])
}

// Results storage
const results = ref({
  Collection: [],
  CRISPR: [],
  Insectary: []
})

// Load all data on mount
onMounted(async () => {
  try {
    const [col, cri, ins] = await Promise.all([
      fetch('./data/collection.json').then(r => r.json()),
      fetch('./data/crispr.json').then(r => r.json()),
      fetch('./data/insectary.json').then(r => r.json())
    ])
    datasets.Collection.value = col
    datasets.CRISPR.value = cri
    datasets.Insectary.value = ins
  } catch (e) {
    console.error("Error loading data for search")
  } finally {
    loading.value = false
  }
})

const performSearch = () => {
  // Parse input: split by commas, spaces, newlines and remove empty
  const targets = inputIds.value.split(/[\s,]+/).filter(Boolean)
  
  if (targets.length === 0) return

  // Reset results
  results.value.Collection = []
  results.value.CRISPR = []
  results.value.Insectary = []

  // Search function
  const searchIn = (data) => data.filter(item => targets.includes(item.CAM_ID))

  results.value.Collection = searchIn(datasets.Collection.value)
  results.value.CRISPR = searchIn(datasets.CRISPR.value)
  results.value.Insectary = searchIn(datasets.Insectary.value)

  hasSearched.value = true
}
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

    <div v-if="hasSearched && !loading">
      
      <!-- Collection Results -->
      <div v-if="results.Collection.length > 0" class="mb-5">
        <h4 class="border-bottom pb-2">Collection Results ({{ results.Collection.length }})</h4>
        <PhotoGrid 
          :loading="false" :isFiltered="true" :items="results.Collection" 
          :totalCount="results.Collection.length" :hasMore="false" 
          side="Dorsal and Ventral" columns="Auto" 
        />
      </div>

      <!-- CRISPR Results -->
      <div v-if="results.CRISPR.length > 0" class="mb-5">
        <h4 class="border-bottom pb-2">CRISPR Results ({{ results.CRISPR.length }})</h4>
        <PhotoGrid 
          :loading="false" :isFiltered="true" :items="results.CRISPR" 
          :totalCount="results.CRISPR.length" :hasMore="false" 
          side="Dorsal and Ventral" columns="Auto" 
        />
      </div>

      <!-- Insectary Results -->
      <div v-if="results.Insectary.length > 0" class="mb-5">
        <h4 class="border-bottom pb-2">Insectary Results ({{ results.Insectary.length }})</h4>
        <PhotoGrid 
          :loading="false" :isFiltered="true" :items="results.Insectary" 
          :totalCount="results.Insectary.length" :hasMore="false" 
          side="Dorsal and Ventral" columns="Auto" 
        />
      </div>

      <!-- No Results -->
      <div v-if="results.Collection.length === 0 && results.CRISPR.length === 0 && results.Insectary.length === 0" class="text-center text-muted mt-5">
        No results found for these IDs.
      </div>

    </div>
  </div>
</template>