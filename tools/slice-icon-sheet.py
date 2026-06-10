#!/usr/bin/env python3
"""Slice a ChatGPT contact-sheet of vehicle line-art into individual icons.

ChatGPT can draw several vehicles in ONE black image (a grid), which is far
faster than one-at-a-time AND keeps the style consistent across the set. This
tool cuts that sheet into individual icons and applies the same luminance key +
brighten + crop as process-vehicle-icons.py, writing
public/icons/vehicles/<stem>.png for each cell.

The grid is split deterministically by count (--rows / --cols), but the cut
LINES are placed at the widest empty bands (gaps between vehicles), so uneven
spacing in the generated sheet doesn't matter. Column cuts are found per-row, so
vehicles in different rows needn't share x-alignment.

Cells are mapped ROW-MAJOR (left-to-right, top-to-bottom) to the --stems list.
Each stem is the output basename, e.g. "german_stug_iii" -> german_stug_iii.png.

Examples:
  # 3 cols x 2 rows sheet, 6 vehicles:
  python3 tools/slice-icon-sheet.py sheet.png --rows 2 --cols 3 \
    --stems german_ostwind_flak_panzer,german_panzerwerfer,german_sdkfz_222,\
german_sdkfz_250,german_halftrack,german_opel_blitz

  # preview only (no write), dump cells to /tmp:
  python3 tools/slice-icon-sheet.py sheet.png --rows 2 --cols 2 --out /tmp/slice_test
"""
import os, sys, argparse
from PIL import Image
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, 'public', 'icons', 'vehicles')

# Keep these in sync with process-vehicle-icons.py.
ALPHA_FLOOR = 12
ALPHA_GAMMA = 0.6
ALPHA_GAIN = 1.25

def key_crop_image(rgb_img):
    """Luminance-key white-on-black -> transparent white strokes, brighten, crop."""
    arr = np.asarray(rgb_img.convert('RGB')).astype(np.float32)
    lum = arr.max(axis=2)
    mask = lum > ALPHA_FLOOR
    t = np.clip((lum - ALPHA_FLOOR) / (255 - ALPHA_FLOOR), 0, 1)
    a = np.clip((t ** ALPHA_GAMMA) * 255 * ALPHA_GAIN, 0, 255)
    a = np.where(mask, a, 0).astype(np.uint8)
    rgba = np.zeros((*lum.shape, 4), np.uint8)
    rgba[..., 0:3] = 255
    rgba[..., 3] = a
    out = Image.fromarray(rgba, 'RGBA')
    bbox = out.getbbox()
    if not bbox:
        return None
    crop = out.crop(bbox); cw, ch = crop.size
    pad = int(cw * 0.05)
    canvas = Image.new('RGBA', (cw + 2 * pad, ch + 2 * pad), (0, 0, 0, 0))
    canvas.paste(crop, (pad, pad), crop)
    tw = 480; th = int(canvas.size[1] * tw / canvas.size[0])
    return canvas.resize((tw, th), Image.LANCZOS)

def find_cuts(proj, ncuts):
    """Return x/y positions of `ncuts` cut lines placed at the centers of the
    widest interior empty bands in the 1-D projection `proj`."""
    if ncuts <= 0:
        return []
    thresh = max(1, int(proj.max() * 0.02))
    n = len(proj)
    runs = []
    i = 0
    while i < n:
        if proj[i] <= thresh:
            j = i
            while j < n and proj[j] <= thresh:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    interior = [r for r in runs if r[0] > 0 and r[1] < n]
    interior.sort(key=lambda r: (r[1] - r[0]), reverse=True)
    chosen = sorted(interior[:ncuts], key=lambda r: r[0])
    return [(r[0] + r[1]) // 2 for r in chosen]

def split_grid(img, rows, cols):
    arr = np.asarray(img.convert('RGB'))
    lum = arr.max(axis=2)
    mask = (lum > ALPHA_FLOOR).astype(np.int32)
    H, W = mask.shape
    ycuts = find_cuts(mask.sum(axis=1), rows - 1)
    ybounds = [0] + ycuts + [H]
    cells = []
    for ri in range(len(ybounds) - 1):
        y0, y1 = ybounds[ri], ybounds[ri + 1]
        strip = mask[y0:y1, :]
        xcuts = find_cuts(strip.sum(axis=0), cols - 1)
        xbounds = [0] + xcuts + [W]
        for ci in range(len(xbounds) - 1):
            x0, x1 = xbounds[ci], xbounds[ci + 1]
            cells.append(img.crop((x0, y0, x1, y1)))
    return cells

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('--rows', type=int, required=True)
    ap.add_argument('--cols', type=int, required=True)
    ap.add_argument('--stems', default='', help='comma list of output basenames, row-major')
    ap.add_argument('--out', default=OUT_DIR)
    args = ap.parse_args()

    img = Image.open(args.sheet)
    cells = split_grid(img, args.rows, args.cols)
    stems = [s.strip() for s in args.stems.split(',') if s.strip()]
    os.makedirs(args.out, exist_ok=True)
    print(f'sheet {img.size}  -> {len(cells)} cells (rows={args.rows} cols={args.cols})')
    for idx, cell in enumerate(cells):
        stem = stems[idx] if idx < len(stems) else f'cell_{idx}'
        keyed = key_crop_image(cell)
        if keyed is None:
            print(f'  [{idx}] {stem}: EMPTY cell (no content)'); continue
        out = os.path.join(args.out, f'{stem}.png')
        keyed.save(out)
        print(f'  [{idx}] {stem}.png  cell={cell.size} -> {keyed.size}')

if __name__ == '__main__':
    main()
