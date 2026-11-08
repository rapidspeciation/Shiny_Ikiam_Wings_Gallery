// A ref that follows a CSS media query (false where matchMedia is missing).
import { ref, onMounted, onBeforeUnmount } from 'vue'

export function useMediaQuery(query) {
  const matches = ref(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  let mq = null
  const onChange = (e) => { matches.value = e.matches }
  onMounted(() => {
    if (typeof window.matchMedia !== 'function') return
    mq = window.matchMedia(query)
    matches.value = mq.matches
    mq.addEventListener?.('change', onChange)
  })
  onBeforeUnmount(() => mq?.removeEventListener?.('change', onChange))
  return matches
}
