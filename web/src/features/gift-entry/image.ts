// The photo pipeline, ported as it is from public/js/gift-entry.js: shrink to 1600 px on the long side, JPEG at 0.85, and measure the
// sharpness on a 160 px copy (the camera refuses a shot below BLUR_MIN). Browser only: every function here runs in an event handler.
import { photoScale } from './logic';

type Drawable = CanvasImageSource;

/** The variance of a Laplacian over a 160 px grey copy of the canvas. A low number is a blurry photo. */
export async function sharpness(canvas: HTMLCanvasElement): Promise<number> {
  const w = 160;
  const h = Math.max(1, Math.round((canvas.height / canvas.width) * 160));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.drawImage(canvas, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let j = 1; j < h - 1; j++)
    for (let i = 1; i < w - 1; i++) {
      const v = 4 * g[j * w + i] - g[j * w + i - 1] - g[j * w + i + 1] - g[(j - 1) * w + i] - g[(j + 1) * w + i];
      s += v;
      s2 += v * v;
      n++;
    }
  const mean = s / n;
  return s2 / n - mean * mean;
}

export interface Jpeg {
  blob: Blob;
  blur: number;
  url: string;
}

export async function toJpeg(source: Drawable, w: number, h: number): Promise<Jpeg> {
  const k = photoScale(w, h);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
  const blur = await sharpness(c);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('The photo could not be shrunk.');
  return { blob, blur, url: URL.createObjectURL(blob) };
}

export async function fileToJpeg(file: File): Promise<Jpeg> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (bmp) return toJpeg(bmp, bmp.width, bmp.height);
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  return toJpeg(img, img.naturalWidth, img.naturalHeight);
}
