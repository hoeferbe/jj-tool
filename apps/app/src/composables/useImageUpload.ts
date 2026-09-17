/**
 * Resizes an image so its longest side is at most `maxDimension` px, then encodes it as JPEG,
 * reducing quality step by step until it's near `targetBytes` (or the quality floor is reached).
 */
export async function compressImage(file: File, maxDimension = 1024, targetBytes = 300 * 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Bildbearbeitung wird von diesem Ger\u00e4t nicht unterst\u00fctzt.')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  let quality = 0.85
  let blob = await canvasToBlob(canvas, quality)
  while (blob.size > targetBytes && quality > 0.4) {
    quality -= 0.15
    blob = await canvasToBlob(canvas, quality)
  }
  return blob
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Bild konnte nicht komprimiert werden.')), 'image/jpeg', quality)
  })
}

/**
 * Fetches an authenticated image and returns a local object URL for use in an `<img src>`.
 * Caller must revoke it with `URL.revokeObjectURL()` once no longer displayed.
 */
export async function fetchImageObjectUrl(url: string, token: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error('Bild konnte nicht geladen werden.')
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}
