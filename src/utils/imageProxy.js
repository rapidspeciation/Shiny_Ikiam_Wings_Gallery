import { ref, computed } from 'vue'

// --- Persisted state (module-level, no store dependency) ---
const STORAGE_KEY = 'imageProxyMode'

const proxyMode = ref(localStorage.getItem(STORAGE_KEY) || 'auto')
const tierStatus = ref({
  wsrv: 'unknown',
  lh3: 'unknown',
  thumbnail: 'unknown'
})

// --- Helpers ---

/**
 * Extract Google Drive file ID from various URL formats.
 * Handles: drive.google.com/uc?id=X, drive.google.com/file/d/X,
 * drive.usercontent.google.com, and unwraps wsrv.nl proxy URLs.
 */
export function extractGoogleDriveFileId(url) {
  if (!url) return null

  let target = url

  // Unwrap wsrv.nl proxy: parse the `url` query param
  if (target.includes('wsrv.nl')) {
    try {
      const parsed = new URL(target)
      const inner = parsed.searchParams.get('url')
      if (inner) target = inner
    } catch { /* not a valid URL, continue */ }
  }

  // drive.google.com/uc?id=FILE_ID
  const ucMatch = target.match(/drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/)
  if (ucMatch) return ucMatch[1]

  // drive.google.com/file/d/FILE_ID
  const fileMatch = target.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (fileMatch) return fileMatch[1]

  // drive.usercontent.google.com/download?id=FILE_ID
  const ucContentMatch = target.match(/drive\.usercontent\.google\.com\/.*id=([a-zA-Z0-9_-]+)/)
  if (ucContentMatch) return ucContentMatch[1]

  // lh3.googleusercontent.com/d/FILE_ID
  const lh3Match = target.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/)
  if (lh3Match) return lh3Match[1]

  // drive.google.com/thumbnail?id=FILE_ID
  const thumbMatch = target.match(/drive\.google\.com\/thumbnail\?.*id=([a-zA-Z0-9_-]+)/)
  if (thumbMatch) return thumbMatch[1]

  return null
}

// --- Tier URL builders ---

function wsrvUrl(fileId, width) {
  return `https://wsrv.nl/?url=${encodeURIComponent('https://drive.google.com/uc?id=' + fileId)}&w=${width}&q=85&output=webp`
}

function lh3Url(fileId, width) {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${width}`
}

function thumbnailUrl(fileId, width) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`
}

// --- Core logic ---

const TIER_ORDER = ['wsrv', 'lh3', 'thumbnail']
const TIER_BUILDERS = { wsrv: wsrvUrl, lh3: lh3Url, thumbnail: thumbnailUrl }

function resolveUrl(originalUrl, width) {
  const fileId = extractGoogleDriveFileId(originalUrl)
  if (!fileId) return originalUrl // not a Drive URL

  const mode = proxyMode.value

  if (mode !== 'auto') {
    return TIER_BUILDERS[mode](fileId, width)
  }

  // Auto mode: cascade through tiers, skip blocked ones
  for (const tier of TIER_ORDER) {
    if (tierStatus.value[tier] !== 'blocked') {
      return TIER_BUILDERS[tier](fileId, width)
    }
  }

  // All blocked — fall back to thumbnail as last resort
  return thumbnailUrl(fileId, width)
}

/**
 * Probe all 3 tiers in parallel using a real file ID.
 * Uses Image objects with no-referrer to test reachability.
 */
export function checkAllTiers(fileId) {
  if (!fileId) return

  const probes = [
    { tier: 'wsrv', url: wsrvUrl(fileId, 1) },
    { tier: 'lh3', url: lh3Url(fileId, 1) },
    { tier: 'thumbnail', url: thumbnailUrl(fileId, 1) }
  ]

  probes.forEach(({ tier, url }) => {
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    img.onload = () => { tierStatus.value[tier] = 'ok' }
    img.onerror = () => { tierStatus.value[tier] = 'blocked' }
    img.src = url
  })
}

/**
 * Detect which tier a URL belongs to and mark it blocked.
 */
export function notifyTierFailed(url) {
  if (!url) return
  if (url.includes('wsrv.nl')) {
    tierStatus.value.wsrv = 'blocked'
  } else if (url.includes('lh3.google')) {
    tierStatus.value.lh3 = 'blocked'
  } else if (url.includes('drive.google.com/thumbnail')) {
    tierStatus.value.thumbnail = 'blocked'
  }
}

// --- Public API ---

export function getProxyState() {
  return { mode: proxyMode, tierStatus }
}

export function setProxyMode(mode) {
  proxyMode.value = mode
  localStorage.setItem(STORAGE_KEY, mode)
}

export function getProxiedUrl(url, { width = 2000 } = {}) {
  return resolveUrl(url, width)
}

export function getThumbnailUrl(url) {
  const fileId = extractGoogleDriveFileId(url)
  if (!fileId) return url
  return thumbnailUrl(fileId, 400)
}
