<script setup>
import { ref, computed, onMounted } from 'vue'
import Panzoom from '@panzoom/panzoom'

const rawData = ref([])
const loading = ref(true)
const error = ref(null)

const filters = ref({
  family: 'All',
  subfamily: 'All',
  species: 'All',
  sex: 'male and female'
})

onMounted(async () => {
  try {
    const response = await fetch('./data/collection.json')
    if (!response.ok) throw new Error("Failed to load data")
    rawData.value = await response.json()
  } catch (e) {
    error.value = "Could not load database. Run the python script to generate data."
  } finally {
    loading.value = false
  }
})

const getUnique = (field, filterSubset = rawData.value) => {
  const set = new Set(filterSubset.map(i => i[field]).filter(Boolean))
  return ['All', ...Array.from(set).sort()]
}

const families = computed(() => getUnique('Family'))
const subfamilies = computed(() => {
  let data = rawData.value
  if (filters.value.family !== 'All') data = data.filter(i => i.Family === filters.value.family)
  return getUnique('Subfamily', data)
})
const speciesList = computed(() => {
  let data = rawData.value
  if (filters.value.subfamily !== 'All') data = data.filter(i => i.Subfamily === filters.value.subfamily)
  return getUnique('Species', data)
})

const filteredData = computed(() => {
  return rawData.value.filter(item => {
    if (filters.value.family !== 'All' && item.Family !== filters.value.family) return false
    if (filters.value.subfamily !== 'All' && item.Subfamily !== filters.value.subfamily) return false
    if (filters.value.species !== 'All' && item.Species !== filters.value.species) return false
    if (filters.value.sex !== 'male and female' && item.Sex !== filters.value.sex) return false
    return true
  })
})

const initZoom = (el) => {
  if (!el) return
  const pz = Panzoom(el, { maxScale: 5 })
  el.parentElement.addEventListener('wheel', (e) => {
    if (!e.shiftKey && !e.ctrlKey) return
    e.preventDefault()
    pz.zoomWithWheel(e)
  })
}
</script>

<template>
  <div>
    <div class="row g-3 mb-4">
      <div class="col-md-3"><label>Family</label><select class="form-select" v-model="filters.family" @change="filters.subfamily = 'All'"><option v-for="opt in families" :key="opt">{{ opt }}</option></select></div>
      <div class="col-md-3"><label>Subfamily</label><select class="form-select" v-model="filters.subfamily"><option v-for="opt in subfamilies" :key="opt">{{ opt }}</option></select></div>
      <div class="col-md-3"><label>Species</label><select class="form-select" v-model="filters.species"><option v-for="opt in speciesList" :key="opt">{{ opt }}</option></select></div>
      <div class="col-md-3"><label>Sex</label><select class="form-select" v-model="filters.sex"><option>male</option><option>female</option><option>male and female</option></select></div>
    </div>
    <div v-if="loading" class="text-center">Loading...</div>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <h5 v-if="!loading" class="text-center mb-4">{{ filteredData.length }} individuals found</h5>
    <div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-4">
      <div class="col" v-for="item in filteredData.slice(0, 50)" :key="item.CAM_ID">
        <div class="gallery-card">
          <h4>{{ item.CAM_ID }}</h4>
          <div class="d-flex justify-content-center">
             <div v-if="item.URLd" class="img-container"><img :src="item.URLd" class="panzoom-img" :ref="initZoom" loading="lazy"></div>
             <div v-if="item.URLv" class="img-container"><img :src="item.URLv" class="panzoom-img" :ref="initZoom" loading="lazy"></div>
          </div>
          <div class="mt-2 text-start small">
            <div><strong>Species:</strong> {{ item.Species }}</div>
            <div><strong>Date:</strong> {{ item.Preservation_date_formatted }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
