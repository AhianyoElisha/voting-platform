/**
 * Nominee photo rules. Validation is pure so it is tested; the resize runs on
 * the server with Sharp (ARCHITECTURE.md "Images") and always re-encodes, so
 * whatever arrives, what we store is a bounded JPEG.
 */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const PHOTO_MAX_DIMENSION = 1600
export const PHOTO_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type PhotoProblem = 'missing' | 'tooLarge' | 'unsupportedType'

export function validatePhotoUpload(file: { size: number; type: string } | null | undefined): PhotoProblem | null {
  if (!file || file.size === 0) return 'missing'
  if (file.size > PHOTO_MAX_BYTES) return 'tooLarge'
  if (!PHOTO_ALLOWED_TYPES.has(file.type.toLowerCase())) return 'unsupportedType'
  return null
}

/** Bounded JPEG, EXIF orientation applied, metadata stripped. */
export async function normalizePhoto(input: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default
  const out = await sharp(input)
    .rotate()
    .resize(PHOTO_MAX_DIMENSION, PHOTO_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()
  return new Uint8Array(out)
}
