// Theme choice: System (follows the device), Light or Dark. Remembered per browser.
// index.html applies it before the first paint and follows the system while on System;
// it reads the choice from data-wg-theme-mode on <html>, so that attribute is the one source of truth.
import { ref } from 'vue'

const STORAGE_KEY = 'wgTheme'
export const THEME_MODES = ['system', 'light', 'dark']

const root = typeof document !== 'undefined' ? document.documentElement : null
const initial = root?.getAttribute('data-wg-theme-mode')
const mode = ref(THEME_MODES.includes(initial) ? initial : 'system')

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
  const theme = next === 'system' ? (systemDark() ? 'dark' : 'light') : next
  root.setAttribute('data-wg-theme-mode', next)
  root.setAttribute('data-bs-theme', theme)
  root.style.colorScheme = theme
}

export function useTheme() {
  return { themeMode: mode, setTheme }
}
