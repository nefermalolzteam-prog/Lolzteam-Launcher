import jsQR from 'jsqr';

/** Beyond this, decoding a full-resolution screenshot costs more than it gains. */
const MAX_PIXELS = 4096 * 2304;

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image_load_failed'));
    image.src = src;
  });

interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const readPixels = (image: HTMLImageElement, region?: Region): ImageData | null => {
  const source: Region = region ?? {
    x: 0,
    y: 0,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
  if (source.width < 1 || source.height < 1) return null;

  // A cropped region is usually small; scaling it up gives the decoder more pixels per module without inventing detail.
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (source.width * source.height)));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
};

/** The decoded payload, or `null` when there is no QR in the image. */
export const decodeQrFromSource = async (src: string, region?: Region): Promise<string | null> => {
  let image: HTMLImageElement;
  try {
    image = await loadImage(src);
  } catch {
    return null;
  }
  const pixels = readPixels(image, region);
  if (!pixels) return null;
  const found = jsQR(pixels.data, pixels.width, pixels.height, {
    inversionAttempts: 'attemptBoth',
  });
  return found?.data ?? null;
};

/** Same, for a file the user dropped, picked or pasted. */
export const decodeQrFromFile = async (file: Blob): Promise<string | null> => {
  const url = URL.createObjectURL(file);
  try {
    return await decodeQrFromSource(url);
  } finally {
    URL.revokeObjectURL(url);
  }
};

export type { Region };
