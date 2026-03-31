import { InputError } from '@/lib/server/errors'

export interface ImageMetadata {
  width: number
  height: number
}

function failUnsupportedImageMetadata(mimeType: string): never {
  throw new InputError('Unsupported image format for edit job upload', {
    mimeType,
  })
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function readPngMetadata(bytes: Uint8Array): ImageMetadata {
  if (bytes.length < 24) {
    throw new InputError('PNG upload is truncated', {
      mimeType: 'image/png',
    })
  }

  return {
    width: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16),
    height: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20),
  }
}

function readJpegMetadata(bytes: Uint8Array): ImageMetadata {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new InputError('JPEG upload is invalid', {
      mimeType: 'image/jpeg',
    })
  }

  let offset = 2

  while (offset + 9 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1
    }

    if (offset >= bytes.length) {
      break
    }

    const marker = bytes[offset]
    offset += 1

    if (marker === 0xd9 || marker === 0xda) {
      break
    }

    if (offset + 1 >= bytes.length) {
      break
    }

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1]

    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)

    if (isStartOfFrame) {
      if (segmentLength < 7) {
        break
      }

      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      }
    }

    offset += segmentLength
  }

  throw new InputError('Could not read JPEG dimensions from upload', {
    mimeType: 'image/jpeg',
  })
}

function readWebpMetadata(bytes: Uint8Array): ImageMetadata {
  if (
    bytes.length < 16 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP'
  ) {
    throw new InputError('WEBP upload is invalid', {
      mimeType: 'image/webp',
    })
  }

  const chunkType = String.fromCharCode(...bytes.slice(12, 16))

  if (chunkType === 'VP8 ') {
    if (bytes.length < 30) {
      throw new InputError('WEBP upload is truncated', {
        mimeType: 'image/webp',
      })
    }

    return {
      width: ((bytes[27] << 8) | bytes[26]) & 0x3fff,
      height: ((bytes[29] << 8) | bytes[28]) & 0x3fff,
    }
  }

  if (chunkType === 'VP8L') {
    if (bytes.length < 25) {
      throw new InputError('WEBP upload is truncated', {
        mimeType: 'image/webp',
      })
    }

    const bits =
      bytes[21] |
      (bytes[22] << 8) |
      (bytes[23] << 16) |
      (bytes[24] << 24)

    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }

  if (chunkType === 'VP8X') {
    if (bytes.length < 30) {
      throw new InputError('WEBP upload is truncated', {
        mimeType: 'image/webp',
      })
    }

    return {
      width: readUInt24LE(bytes, 24) + 1,
      height: readUInt24LE(bytes, 27) + 1,
    }
  }

  throw new InputError('Unsupported WEBP variant for edit job upload', {
    mimeType: 'image/webp',
    chunkType,
  })
}

export function readImageMetadata(
  bytes: Uint8Array,
  mimeType: string,
): ImageMetadata {
  if (mimeType === 'image/png') {
    return readPngMetadata(bytes)
  }

  if (mimeType === 'image/jpeg') {
    return readJpegMetadata(bytes)
  }

  if (mimeType === 'image/webp') {
    return readWebpMetadata(bytes)
  }

  return failUnsupportedImageMetadata(mimeType)
}
