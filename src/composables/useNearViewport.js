import { ref, onMounted, onBeforeUnmount } from 'vue'

// One IntersectionObserver for every card: `near` is true while the element is in
// the viewport or within MARGIN of it, so heavy overlays exist only there.
const MARGIN = '800px 0px'
const callbacks = new WeakMap()
let observer = null

function getObserver() {
  if (!observer && typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting)
    }, { rootMargin: MARGIN })
  }
  return observer
}

export function useNearViewport(elRef) {
  const near = ref(false)
  let el = null
  onMounted(() => {
    el = elRef.value
    const io = getObserver()
    if (!el || !io) { near.value = true; return }
    callbacks.set(el, value => { near.value = value })
    io.observe(el)
  })
  onBeforeUnmount(() => {
    if (el && observer) { observer.unobserve(el); callbacks.delete(el) }
  })
  return near
}
