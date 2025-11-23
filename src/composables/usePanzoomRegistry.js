import { ref } from 'vue'

// Global state to hold references to all active Panzoom instances
const instances = new Set()

export function usePanzoomRegistry() {

  const register = (instance) => {
    instances.add(instance)
  }

  const unregister = (instance) => {
    instances.delete(instance)
  }

  const zoomAll = (e) => {
    // Determine zoom direction
    const delta = e.deltaY === 0 && e.deltaX ? e.deltaX : e.deltaY
    const scaleMultiplier = delta < 0 ? 1.1 : 0.9 // Zoom In vs Out

    instances.forEach(pz => {
      // Get current scale to calculate new scale
      const currentScale = pz.getScale()
      pz.zoom(currentScale * scaleMultiplier, { animate: true })
    })
  }

  return {
    register,
    unregister,
    zoomAll
  }
}
