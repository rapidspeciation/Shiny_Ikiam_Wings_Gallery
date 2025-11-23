import { onMounted, onUnmounted } from 'vue'

const instances = new Set()

export function usePanzoomRegistry() {

  const register = (instance) => {
    instances.add(instance)
  }

  const unregister = (instance) => {
    instances.delete(instance)
  }

  const zoomAll = (e) => {
    const delta = e.deltaY === 0 && e.deltaX ? e.deltaX : e.deltaY
    const scaleMultiplier = delta < 0 ? 1.1 : 0.9 // Zoom In vs Out

    instances.forEach(pz => {
      const currentScale = pz.getScale()
      pz.zoom(currentScale * scaleMultiplier, { animate: true })
    })
  }

  // --- NEW: Global Listener Logic ---
  const attachGlobalListeners = () => {
    const handler = (e) => {
      // Check for Shift key
      if (e.shiftKey) {
        e.preventDefault() // Stop page scroll
        zoomAll(e)
      }
    }

    onMounted(() => {
      window.addEventListener('wheel', handler, { passive: false })
    })

    onUnmounted(() => {
      window.removeEventListener('wheel', handler)
    })
  }

  return {
    register,
    unregister,
    zoomAll,
    attachGlobalListeners
  }
}
