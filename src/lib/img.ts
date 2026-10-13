// Wikimedia Commons image URLs. `img` is the hash path from the build step,
// e.g. "c/c3/Flag_of_France.svg". Commons only serves thumbnails at standard
// widths, so sizes are snapped to those.

const BASE = 'https://upload.wikimedia.org/wikipedia/commons';
const WIDTHS = [120, 250, 330, 500, 960, 1280] as const;

function encodePath(img: string): { dir: string; file: string } {
  const i = img.lastIndexOf('/');
  return { dir: img.slice(0, i), file: encodeURIComponent(img.slice(i + 1)) };
}

/**
 * Fallback URL via Special:FilePath, which follows Commons file renames (the
 * hash path doesn't) and serves a thumbnail of any size.
 */
export function original(img: string, width = 500): string {
  const file = img.slice(img.lastIndexOf('/') + 1);
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

export function thumb(img: string, width: number): string {
  const w = WIDTHS.find((x) => x >= width) ?? WIDTHS[WIDTHS.length - 1];
  const { dir, file } = encodePath(img);
  const isVector = /\.svg$/i.test(file);
  // Raster thumbnails keep the original extension; SVGs are rendered to PNG.
  const name = isVector ? `${w}px-${file}.png` : `${w}px-${file}`;
  return `${BASE}/thumb/${dir}/${file}/${name}`;
}

export function commonsPage(image: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(image.replace(/ /g, '_'))}`;
}
