// Theme choice: follows the device until the visitor picks Light or Dark with the navbar's
// sun/moon button (ThemeToggle.vue); the pick is remembered per browser. The gear menu can
// go back to following the device. index.html applies the choice before the first paint and
// follows the system while nothing is picked; it reads the choice from data-wg-theme-mode on
// <html>, so that attribute is the one source of truth.
import { ref } from 'vue'

const STORAGE_KEY = 'wgTheme'
export const THEME_MODES = ['system', 'light', 'dark']

const root = typeof document !== 'undefined' ? document.documentElement : null
const initial = root?.getAttribute('data-wg-theme-mode')
const mode = ref(THEME_MODES.includes(initial) ? initial : 'system')
// the theme on screen (light or dark), whatever the mode
const readTheme = () => (root?.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light')
const theme = ref(readTheme())
if (root && typeof MutationObserver === 'function') {
  new MutationObserver(() => { theme.value = readTheme() })
    .observe(root, { attributes: true, attributeFilter: ['data-bs-theme'] })
}

function systemDark() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function setTheme(next) {
  if (!THEME_MODES.includes(next)) return
  mode.value = next
  try {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
  } catch { /* storage blocked: the choice holds until the page is closed */ }
  if (!root) return
  const t = next === 'system' ? (systemDark() ? 'dark' : 'light') : next
  root.setAttribute('data-wg-theme-mode', next)
  root.setAttribute('data-bs-theme', t)
  root.style.colorScheme = t
  theme.value = t
}

// the sun/moon button: switch to the other theme and remember it
export function toggleTheme() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}

export function useTheme() {
  return { themeMode: mode, theme, setTheme, toggleTheme }
}
