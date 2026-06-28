/**
 * imageParser.js — load ordinary raster images (PNG/JPEG/WebP/GIF/BMP) as a
 * 3-band (R, G, B) datacube so they flow through the same viewer / annotation /
 * export pipeline as hyperspectral data.
 *
 * The decoded cube is BIP-interleaved (per pixel: R, G, B) with float32 values
 * in the 0–255 range, matching what the worker and renderer expect.
 */

export const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i

/**
 * Decode an image File into { datacube, metadata }.
 *
 * @param {File|Blob} file — an image file
 * @returns {Promise<{ datacube: Float32Array, metadata: object }>}
 */
export async function parseImage(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('Could not decode image — unsupported or corrupt file.'))
      im.src = url
    })

    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) throw new Error('Image has zero dimensions.')

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, w, h) // RGBA, Uint8ClampedArray

    const bands = 3
    const pixels = w * h
    // BIP order: [line][sample][band] → datacube[p * bands + b]
    const datacube = new Float32Array(pixels * bands)
    for (let p = 0; p < pixels; p++) {
      const s = p * 4
      const d = p * 3
      datacube[d] = data[s]       // R
      datacube[d + 1] = data[s + 1] // G
      datacube[d + 2] = data[s + 2] // B
    }

    return {
      datacube,
      metadata: {
        samples: w,
        lines: h,
        bands,
        dataType: 4,
        dataTypeSize: 4,
        interleave: 'bip',
        byteOrder: 0,
        wavelengths: null,
        isRGBImage: true,
      },
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
