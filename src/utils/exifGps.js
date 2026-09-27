// Minimal, dependency-free EXIF GPS reader for JPEG photos (APP1 "Exif" segment).
// Reads GPSLatitudeRef / GPSLatitude / GPSLongitudeRef / GPSLongitude from the
// GPS IFD. Returns { lat, lon } in decimal degrees, or null when there is no
// usable GPS position. The photo is downscaled through a canvas before upload,
// so the GPS tags never leave the browser.

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

// buf: ArrayBuffer (or a view) with at least the start of the JPEG file.
export function readJpegGps(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.byteLength < 4 || dv.getUint16(0) !== 0xffd8) return null
  let o = 2
  while (o + 4 <= dv.byteLength) {
    if (dv.getUint8(o) !== 0xff) return null
    const marker = dv.getUint8(o + 1)
    if (marker === 0xff) { o += 1; continue }               // fill byte
    if (marker === 0xda || marker === 0xd9) return null     // start of scan / end of image: no EXIF before the data
    if (marker >= 0xd0 && marker <= 0xd7) { o += 2; continue }
    const len = dv.getUint16(o + 2)
    if (len < 2) return null
    const start = o + 4, end = Math.min(o + 2 + len, dv.byteLength)
    if (marker === 0xe1 && end - start > 14 &&
        dv.getUint32(start) === 0x45786966 && dv.getUint16(start + 4) === 0) {   // "Exif\0\0"
      const gps = readTiffGps(new DataView(bytes.buffer, bytes.byteOffset + start + 6, end - start - 6))
      if (gps) return gps
    }
    o += 2 + len
  }
  return null
}

// TIFF structure inside the APP1 segment (offsets relative to the TIFF header).
export function readTiffGps(t) {
  try {
    const bo = t.getUint16(0)
    if (bo !== 0x4949 && bo !== 0x4d4d) return null
    const le = bo === 0x4949
    if (t.getUint16(2, le) !== 42) return null
    const ifd0 = readIfd(t, t.getUint32(4, le), le)
    const gpsPtr = ifd0.get(0x8825)
    if (!gpsPtr) return null
    const gps = readIfd(t, value(t, gpsPtr, le)[0], le)
    const latRef = gps.has(1) ? ascii(t, gps.get(1)) : ''
    const lonRef = gps.has(3) ? ascii(t, gps.get(3)) : ''
    if (!gps.has(2) || !gps.has(4)) return null
    const lat = dms(value(t, gps.get(2), le)) * (/^S/i.test(latRef) ? -1 : 1)
    const lon = dms(value(t, gps.get(4), le)) * (/^W/i.test(lonRef) ? -1 : 1)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
    if (lat === 0 && lon === 0) return null   // cameras without a fix often write 0/0
    return { lat, lon }
  } catch {
    return null   // truncated or malformed EXIF
  }
}

// tag -> { type, count, at } where `at` is the offset of the value (inline or pointed to)
function readIfd(t, off, le) {
  const out = new Map()
  const n = t.getUint16(off, le)
  for (let i = 0; i < n; i++) {
    const e = off + 2 + 12 * i
    const tag = t.getUint16(e, le), type = t.getUint16(e + 2, le), count = t.getUint32(e + 4, le)
    const size = (TYPE_SIZE[type] || 1) * count
    out.set(tag, { type, count, at: size <= 4 ? e + 8 : t.getUint32(e + 8, le) })
  }
  return out
}

function value(t, { type, count, at }, le) {
  const v = []
  for (let i = 0; i < count; i++) {
    if (type === 5 || type === 10) {
      const num = type === 5 ? t.getUint32(at + 8 * i, le) : t.getInt32(at + 8 * i, le)
      const den = type === 5 ? t.getUint32(at + 8 * i + 4, le) : t.getInt32(at + 8 * i + 4, le)
      v.push(den ? num / den : NaN)
    } else if (type === 4) v.push(t.getUint32(at + 4 * i, le))
    else if (type === 9) v.push(t.getInt32(at + 4 * i, le))
    else if (type === 3) v.push(t.getUint16(at + 2 * i, le))
    else v.push(t.getUint8(at + i))
  }
  return v
}

function ascii(t, { count, at }) {
  let s = ''
  for (let i = 0; i < count; i++) { const c = t.getUint8(at + i); if (!c) break; s += String.fromCharCode(c) }
  return s.trim()
}

const dms = (v) => (v.length >= 3 ? v[0] + v[1] / 60 + v[2] / 3600 : v.length ? v[0] : NaN)

// Read GPS from a File/Blob; EXIF sits at the start of a JPEG, so 256 KB is plenty.
export async function readGpsFromFile(file) {
  try {
    if (!file || !(/jpe?g/i.test(file.type || '') || /\.jpe?g$/i.test(file.name || ''))) return null
    return readJpegGps(await file.slice(0, 262144).arrayBuffer())
  } catch {
    return null
  }
}
