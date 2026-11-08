<script setup>
// One large view of a gallery photo (same proxied image the card shows).
// A click on the photo (or "Full size") switches between fitting the screen and its
// natural size, where it scrolls and drags to pan. Left/Right or the side buttons flip
// to the card's other photo (dorsal, ventral). Esc, the close button or a click outside
// the photo dismiss it; the page behind does not scroll while it is open.
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { usePhotoLightbox } from '../composables/usePhotoLightbox.js'

const { state, current, step, closeLightbox } = usePhotoLightbox()
const root = ref(null)
const closeBtn = ref(null)
const stage = ref(null)
const full = ref(false)
const multi = computed(() => state.photos.length > 1)

// keys are read on the document: a click on the photo leaves focus on the page body
watch(() => state.open, (on) => {
  document.body.style.overflow = on ? 'hidden' : ''
  full.value = false
  if (on) {
    document.addEventListener('keydown', onKey)
    nextTick(() => closeBtn.value?.focus())
  } else document.removeEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKey)
})

// rx, ry: the point (0..1 of the photo) to bring to the middle at natural size
async function setFull(on, rx = 0.5, ry = 0.5) {
  full.value = on
  if (!on) return
  await nextTick()
  const el = stage.value
  if (!el) return
  el.scrollLeft = rx * el.scrollWidth - el.clientWidth / 2
  el.scrollTop = ry * el.scrollHeight - el.clientHeight / 2
}

// mouse drag pans the natural-size photo (touch scrolls it natively)
let drag = null
let dragged = false
function onPointerDown(e) {
  dragged = false
  if (!full.value || e.pointerType !== 'mouse' || e.button !== 0) return
  drag = { x: e.clientX, y: e.clientY, left: stage.value.scrollLeft, top: stage.value.scrollTop }
}
function onPointerMove(e) {
  if (!drag) return
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y
  if (Math.hypot(dx, dy) > 5) dragged = true
  stage.value.scrollLeft = drag.left - dx
  stage.value.scrollTop = drag.top - dy
}
function onPointerUp() { drag = null }

function onImgClick(e) {
  if (dragged) { dragged = false; return }
  if (full.value) { setFull(false); return }
  const img = e.currentTarget
  setFull(true, e.offsetX / (img.clientWidth || 1), e.offsetY / (img.clientHeight || 1))
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeLightbox() }
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && multi.value) {
    e.preventDefault()
    step(e.key === 'ArrowLeft' ? -1 : 1)
  } else if (e.key === 'Tab') {
    // keep focus inside the dialog
    const items = [...(root.value?.querySelectorAll('button, a[href]') || [])]
    if (!items.length) return
    const i = items.indexOf(document.activeElement)
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === -1 || i === items.length - 1 ? 0 : i + 1)
    e.preventDefault()
    items[next].focus()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="state.open" ref="root" class="lb-backdrop" role="dialog" aria-modal="true" :aria-label="current.caption || 'Photo'"
      @click.self="closeLightbox">
      <button ref="closeBtn" type="button" class="btn-close btn-close-white lb-close" aria-label="Close" @click="closeLightbox"></button>
      <figure class="lb-figure" @click.self="closeLightbox">
        <div ref="stage" class="lb-stage" :class="{ full }" @click.self="closeLightbox"
          @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @pointerleave="onPointerUp">
          <img :src="current.src" :alt="current.alt" referrerpolicy="no-referrer" draggable="false" @click="onImgClick" />
        </div>
        <figcaption class="lb-bar">
          <span>{{ current.caption }}</span>
          <button type="button" class="btn btn-sm btn-outline-light lb-btn" :aria-pressed="full" @click="setFull(!full)">
            {{ full ? 'Fit to screen' : 'Full size' }}
          </button>
          <a class="lb-link" :href="current.src" target="_blank" rel="noopener noreferrer">Open original</a>
        </figcaption>
      </figure>
      <template v-if="multi">
        <button type="button" class="lb-nav lb-prev" aria-label="Previous photo" @click="step(-1)">&lsaquo;</button>
        <button type="button" class="lb-nav lb-next" aria-label="Next photo" @click="step(1)">&rsaquo;</button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.lb-backdrop { --wg-focus: #fff; position: fixed; inset: 0; z-index: 1070; background: rgba(10, 12, 15, 0.9); display: flex; align-items: center; justify-content: center; padding: 3rem 1rem 1rem; }
.lb-close { position: absolute; top: 0.75rem; right: 0.75rem; width: 1.5em; height: 1.5em; padding: 0.5rem; opacity: 0.9; z-index: 2; }
.lb-figure { margin: 0; max-width: 100%; max-height: 100%; display: flex; flex-direction: column; align-items: center; gap: 0.4rem; }
.lb-stage { --lb-h: calc(100vh - 7rem); display: flex; max-width: 96vw; max-height: var(--lb-h); }
@supports (height: 100dvh) { .lb-stage { --lb-h: calc(100dvh - 7rem); } }
.lb-stage img { max-width: 96vw; max-height: var(--lb-h); object-fit: contain; border-radius: 4px; background: #111; cursor: zoom-in; user-select: none; }
/* natural size: the photo scrolls (and drags) inside the stage; margin auto centres a small one safely */
.lb-stage.full { width: 96vw; height: var(--lb-h); overflow: auto; overscroll-behavior: contain; cursor: grab; }
.lb-stage.full:active { cursor: grabbing; }
.lb-stage.full img { max-width: none; max-height: none; margin: auto; flex: 0 0 auto; border-radius: 0; cursor: zoom-out; }
.lb-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; column-gap: 0.9rem; row-gap: 0.3rem; color: #e9ecef; font-size: 0.85rem; }
.lb-btn { padding: 0.1rem 0.55rem; font-size: 0.8rem; }
.lb-link { color: #9ec5fe; }
.lb-link:hover { color: #cfe2ff; }
.lb-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border: 1px solid rgba(255, 255, 255, 0.5); border-radius: 50%; background: rgba(20, 23, 27, 0.7); color: #fff; font-size: 1.8rem; line-height: 1; padding: 0 0 0.2rem; display: flex; align-items: center; justify-content: center; z-index: 2; }
.lb-nav:hover { background: rgba(50, 55, 62, 0.9); }
.lb-prev { left: 0.6rem; }
.lb-next { right: 0.6rem; }
</style>
