// Prebuilt field-photo index (public/data/field_photos/, one file per genus),
// so the reference panel does not wait on a live iNaturalist search (2.5-7 s
// for a taxon iNaturalist has not served recently). Built from the GBIF
// downloads used for training: iNaturalist research-grade adults under the
// model's current names, up to 60 per taxon with every country represented
// (WingsClassificator reports/field_photo_index_20260928). Taxa missing here
// fall back to the live search in inatPhotos.js.
//
// Shard row: [photo_id, ext ('' = jpg), observation_id, observer, country_code, region]

import { webImageUrl } from './imageProxy.js'
import { countryName } from './geoPrior.js'

const BASE = `${(import.meta.env && import.meta.env.BASE_URL) || '/'}data/field_photos`
const S3 = 'https://inaturalist-open-data.s3.amazonaws.com/photos'

export const photoUrl = (row, size) => `${S3}/${row[0]}/${size}.${row[1] || 'jpg'}`

// Row -> the photo entry shape of parseObservations (inatPhotos.js).
// Country names match the location picker (geoPrior.countryName).
export function rowToPhoto(row, taxon) {
  const country = countryName(row[4])
  return {
    id: row[2],
    url: webImageUrl(photoUrl(row, 'large'), 900),
    thumb: webImageUrl(photoUrl(row, 'small'), 160),
    small: photoUrl(row, 'small'),
    place: [row[5], country].filter(Boolean).join(', '),
    country,
    observer: row[3] || '',
    link: `https://www.inaturalist.org/observations/${row[2]}`,
    taxon,
  }
}

// -> async (name) => { photos } | null (not in the index)
export function createFieldPhotoIndex({ fetchImpl = (...a) => globalThis.fetch(...a), base = BASE } = {}) {
  let meta = null
  const shards = new Map()
  const getJson = (url) => fetchImpl(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  const loadMeta = () => (meta ||= getJson(`${base}/index.json`).then((m) => m || { genera: {} }))
  function loadShard(genus) {
    if (!shards.has(genus)) {
      const p = getJson(`${base}/${encodeURIComponent(genus)}.json`).then((j) => j?.t || {})
      p.then((t) => { if (!Object.keys(t).length) shards.delete(genus) })   // a failed load can retry later
      shards.set(genus, p)
    }
    return shards.get(genus)
  }
  return async function lookup(name) {
    const taxon = String(name || '').trim()
    const genus = taxon.split(/\s+/)[0]
    if (!genus) return null
    const m = await loadMeta()
    if (!m.genera?.[genus]) return null
    const rows = (await loadShard(genus))[taxon]
    if (!rows?.length) return null
    return { photos: rows.map((r) => rowToPhoto(r, taxon)) }
  }
}
