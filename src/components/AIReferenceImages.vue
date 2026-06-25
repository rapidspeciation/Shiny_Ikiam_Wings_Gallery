<script setup>
// Reference photos for a predicted taxon: Sanger collection first, GBIF (museum-
// first) fallback. Shown to the right of the uploaded image so the user can compare.
import { ref, watch } from 'vue'
import { referencesFor } from '../utils/aiReference.js'

const props = defineProps({ taxon: { type: String, default: '' } })

const state = ref('idle') // idle | loading | ready | empty
const data = ref({ photos: [], source: 'none', level: 'none' })

watch(() => props.taxon, async (t) => {
  if (!t) { state.value = 'idle'; return }
  state.value = 'loading'
  try {
    data.value = await referencesFor(t)
    state.value = data.value.photos.length ? 'ready' : 'empty'
  } catch {
    state.value = 'empty'
  }
}, { immediate: true })

const sourceLabel = (s) => (s === 'sanger' ? 'Sanger / Ikiam collection' : s === 'gbif' ? 'GBIF' : '')
</script>

<template>
  <div class="ai-ref">
    <div class="d-flex align-items-baseline justify-content-between mb-1">
      <span class="fw-bold small">Reference photos</span>
      <span v-if="state === 'ready'" class="text-muted" style="font-size:0.7rem">
        {{ sourceLabel(data.source) }}<span v-if="data.level === 'species'"> · species-level</span>
      </span>
    </div>

    <div v-if="state === 'loading'" class="text-muted small d-flex align-items-center gap-2 py-2">
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Finding reference photos…
    </div>
    <div v-else-if="state === 'empty'" class="text-muted small py-2">
      No reference photo found for <em>{{ taxon }}</em> yet.
    </div>
    <div v-else-if="state === 'ready'" class="ref-grid">
      <figure v-for="(p, i) in data.photos" :key="i" class="ref-fig">
        <component :is="p.link ? 'a' : 'div'" :href="p.link" target="_blank" rel="noopener noreferrer">
          <img :src="p.thumb || p.url" :alt="`Reference photo of ${taxon}`" loading="lazy" referrerpolicy="no-referrer" />
        </component>
        <figcaption>
          <span class="cap">{{ p.caption }}</span>
          <span class="credit">{{ p.credit }}</span>
        </figcaption>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.ref-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.5rem; }
.ref-fig { margin: 0; }
.ref-fig img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; background: #f8fafc; }
.ref-fig figcaption { font-size: 0.62rem; line-height: 1.2; color: #64748b; margin-top: 2px; }
.ref-fig .cap { display: block; font-weight: 600; color: #475569; }
.ref-fig .credit { display: block; }
@media (max-width: 575px) { .ref-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); } }
</style>
