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
      <div class="custom-grid" :style="{
        '--col-count': columns === 'Auto' ? 'auto-fill' : columns
      }">
        <div class="grid-item" v-for="item in items" :key="item.CAM_ID">
          <PhotoCard :item="item" :side="side" />
        </div>
      </div>

      <!-- Load More Button -->
      <div v-if="hasMore" class="text-center mt-5 mb-5">
        <button class="btn btn-outline-primary btn-lg px-5" @click="$emit('loadMore')">
          Load More
        </button>
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
  gap: 1.5rem; /* Matches Bootstrap g-4 */
}

/*
   If Auto: Use minmax to make them responsive (approx 300px wide).
   If Number: Split 1fr equally X times.
*/
.custom-grid {
  grid-template-columns: repeat(
    var(--col-count, auto-fill),
    minmax(v-bind("columns === 'Auto' ? '300px' : '0px'"), 1fr)
  );
}
</style>
