import test from 'node:test'
import assert from 'node:assert/strict'
import { getProxiedUrl, setProxyMode, isHeicName, driveViewUrl, retryUrl } from '../src/utils/imageProxy.js'

const DRIVE = 'https://drive.google.com/uc?id=1f0SbuWOGBGYrZPVc6HXk4s4ApbveyV-0'

test('HEIC photos always go through wsrv.nl, the only tier that converts them, whatever the mode', () => {
  assert.ok(isHeicName('CAM076567v2.HEIC') && isHeicName('x.heif') && !isHeicName('CAM077741d.JPG') && !isHeicName(''))
  for (const mode of ['auto', 'wsrv', 'lh3', 'thumbnail']) {
    setProxyMode(mode)
    const url = getProxiedUrl(DRIVE, { name: 'CAM076567v2.HEIC' })
    assert.match(url, /^https:\/\/wsrv\.nl\/\?url=https%3A%2F%2Fdrive\.google\.com%2Fuc%3Fid%3D1f0SbuWOGBGYrZPVc6HXk4s4ApbveyV-0&w=2000/, mode)
  }
  // a JPEG keeps following the chosen mode
  setProxyMode('lh3')
  assert.equal(getProxiedUrl(DRIVE, { name: 'CAM077741d.JPG' }), 'https://lh3.googleusercontent.com/d/1f0SbuWOGBGYrZPVc6HXk4s4ApbveyV-0=w2000')
  setProxyMode('auto')
})

test('Open original for a HEIC the browser cannot show links to the file on Drive', () => {
  assert.equal(driveViewUrl(DRIVE), 'https://drive.google.com/file/d/1f0SbuWOGBGYrZPVc6HXk4s4ApbveyV-0/view')
})

test('a failed HEIC conversion is retried once with a cache-busting parameter', () => {
  const first = getProxiedUrl(DRIVE, { name: 'CAM076567v2.HEIC' })
  const again = retryUrl(first)
  assert.ok(again.startsWith(first + '&retry='))
  assert.match(retryUrl('https://example.org/a.heic'), /^https:\/\/example\.org\/a\.heic\?retry=\d+$/)
})
