import { describe, expect, test } from 'vitest'
import { PHOTO_MAX_BYTES, validatePhotoUpload } from '../photo'

describe('validatePhotoUpload', () => {
  test('accepts jpeg, png and webp within the size limit', () => {
    expect(validatePhotoUpload({ size: 1000, type: 'image/jpeg' })).toBeNull()
    expect(validatePhotoUpload({ size: 1000, type: 'image/PNG' })).toBeNull()
    expect(validatePhotoUpload({ size: PHOTO_MAX_BYTES, type: 'image/webp' })).toBeNull()
  })

  test('rejects missing, oversized and other types', () => {
    expect(validatePhotoUpload(null)).toBe('missing')
    expect(validatePhotoUpload({ size: 0, type: 'image/jpeg' })).toBe('missing')
    expect(validatePhotoUpload({ size: PHOTO_MAX_BYTES + 1, type: 'image/jpeg' })).toBe('tooLarge')
    expect(validatePhotoUpload({ size: 10, type: 'image/gif' })).toBe('unsupportedType')
    expect(validatePhotoUpload({ size: 10, type: 'application/pdf' })).toBe('unsupportedType')
  })
})
