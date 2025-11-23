<script setup>
import PhotoCard from './PhotoCard.vue'

const props = defineProps({
  loading: Boolean,
  isFiltered: Boolean,
  items: Array,
  totalCount: Number,
  hasMore: Boolean,
  side: String,
  error: String,
  columns: { type: [String, Number], default: 'Auto' }
})

defineEmits(['loadMore'])
</script>

<template>
  <div class="mt-4">
    <!-- Loading / Error States -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
      <p class="mt-2">Loading Database...</p>
    </div>
    
    <div v-if="error" class="alert alert-danger">{{ error }}</div>

    <!-- Results -->
    <div v-if="!loading && isFiltered">
      <h4 class="text-center mb-4 fw-bold">{{ totalCount }} individuals found</h4>
      <p v-if="totalCount > 0" class="text-center text-muted small mb-4">
        Showing {{ items.length }} of {{ totalCount }} photos
      </p>

      <!-- Dynamic Grid System -->
      <div class="custom-grid" :class="`cols-${columns}`">
        <div class="grid-item" v-for="item in items" :key="item.CAM_ID">
          <PhotoCard :item="item" :side="side" />
        </div>
      </div>

      <div v-if="hasMore" class="text-center mt-5 mb-5">
        <button class="btn btn-outline-primary btn-lg px-5" @click="$emit('loadMore')">Load More</button>
      </div>
      
      <div v-if="totalCount === 0" class="text-center text-muted py-5">
        No results found matching these filters.
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-grid {
  display: grid;
  gap: 1.5rem;
}

/* 1 Column */
.cols-1 { grid-template-columns: 1fr; }

/* 2 Columns */
.cols-2 { grid-template-columns: repeat(2, 1fr); }

/* 3 Columns */
.cols-3 { grid-template-columns: repeat(3, 1fr); }

/* 
   Auto Configuration 
   ------------------
   OLD: minmax(max(350px, 30%), 1fr)
   NEW: minmax(max(560px, 30%), 1fr)
   
   Logic:
   1. max(560px, 30%): Ensures we never have more than 3 columns (because 30% * 4 > 100%).
   2. 560px Min Width:
      - On your 1460px effective screen: Fits 2 columns (1120px), but not 3 (1680px). -> DEFAULT 2 COLS.
      - Zoomed to 130% (~1120px screen): Fits 1 column comfortably, edges into 2. 
      - Any further zoom drops strictly to 1 column.
*/
.cols-Auto {
  grid-template-columns: repeat(auto-fill, minmax(max(560px, 30%), 1fr));
}

/* Force 1 column on mobile devices regardless of calculations */
@media (max-width: 768px) {
  .cols-Auto, .cols-2, .cols-3 { grid-template-columns: 1fr; }
}
</style>