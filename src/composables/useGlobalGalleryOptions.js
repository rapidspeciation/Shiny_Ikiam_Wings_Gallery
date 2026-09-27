import { reactive, toRefs } from 'vue'

import { VIEW_DEFAULTS } from '../utils/shareView.js'

const state = reactive({ ...VIEW_DEFAULTS })

export function useGlobalGalleryOptions() {
  return toRefs(state)
}
