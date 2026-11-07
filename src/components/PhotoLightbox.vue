<script setup>
// One large view of a gallery photo (same proxied image the card shows).
// Esc, the close button or a click outside the photo dismiss it; the page
// behind does not scroll while it is open.
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { usePhotoLightbox } from '../composables/usePhotoLightbox.js'

const { state, closeLightbox } = usePhotoLightbox()
const closeBtn = ref(null)

watch(() => state.open, (on) => {
  document.body.style.overflow = on ? 'hidden' : ''
  if (on) nextTick(() => closeBtn.value?.focus())
})
onBeforeUnmount(() => { document.body.style.overflow = '' })

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeLightbox() }
  else if (e.key === 'Tab') { e.preventDefault(); closeBtn.value?.focus() }   // only one control inside
}
</script>

<template>
  <Teleport to="body">
    <div v-if="state.open" class="lb-backdrop" role="dialog" aria-modal="true" :aria-label="state.caption || 'Photo'"
      @click.self="closeLightbox" @keydown="onKey">
      <button ref="closeBtn" type="button" class="btn-close btn-close-white lb-close" aria-label="Close" @click="closeLightbox"></button>
      <figure class="lb-figure" @click.self="closeLightbox">
        <img :src="state.src" :alt="state.alt" referrerpolicy="no-referrer" />
        <figcaption v-if="state.caption">{{ state.caption }}</figcaption>
      </figure>
    </div>
  </Teleport>
</template>

<style scoped>
.lb-backdrop { position: fixed; inset: 0; z-index: 1070; background: rgba(10, 12, 15, 0.9); display: flex; align-items: center; justify-content: center; padding: 3rem 1rem 1rem; }
.lb-close { position: absolute; top: 0.75rem; right: 0.75rem; width: 1.5em; height: 1.5em; padding: 0.5rem; opacity: 0.9; }
.lb-close:focus-visible { outline: 2px solid #fff; outline-offset: 2px; box-shadow: none; }
.lb-figure { margin: 0; max-width: 100%; max-height: 100%; display: flex; flex-direction: column; align-items: center; gap: 0.4rem; }
.lb-figure img { max-width: 96vw; max-height: calc(100vh - 6rem); object-fit: contain; border-radius: 4px; background: #111; }
.lb-figure figcaption { color: #e9ecef; font-size: 0.85rem; }
</style>
