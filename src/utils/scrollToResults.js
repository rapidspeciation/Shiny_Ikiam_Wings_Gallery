// After a new query (Show Photos, Search, a shared link), bring the results heading
// up under the sticky navbar, so the first photos are on screen without a scroll.
// Left alone when the heading already sits in the top part of the screen.
export function scrollToResults(el) {
  if (!el || typeof window === 'undefined') return
  const nav = document.querySelector('nav.sticky-top')
  const offset = (nav ? nav.getBoundingClientRect().height : 0) + 8
  const top = el.getBoundingClientRect().top
  if (top >= offset - 1 && top <= window.innerHeight * 0.3) return
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: Math.max(0, window.scrollY + top - offset), behavior: reduce ? 'auto' : 'smooth' })
}
