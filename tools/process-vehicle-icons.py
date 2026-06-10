#!/usr/bin/env python3
"""Key + crop dropped vehicle icons into bundled faction overrides.

Drop a PNG into ~/Documents/icons/ named after the vehicle's display name
(e.g. "King Tiger.png", "Sd.Kfz. 251.png"). This parses src/lib/vehicles.ts
for the authoritative displayName -> (faction, id) map, luminance-keys the
white-on-black line art to transparent white strokes, tight-crops to the
content bbox (native aspect, no square forcing), and writes
public/icons/vehicles/<faction>_<id>.png.

Run from repo root:  python3 tools/process-vehicle-icons.py [--dir DIR]
"""
import os, re, sys, argparse
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VEHICLES_TS = os.path.join(REPO, 'src', 'lib', 'vehicles.ts')
OUT_DIR = os.path.join(REPO, 'public', 'icons', 'vehicles')

# German umlauts / eszett are transliterated to their ASCII equivalents BEFORE
# stripping, so the intuitive filename spelling matches the display name:
#   "Brummbär" -> "brummbar"  (matches a dropped "Brummbar.png")
#   "Kübelwagen" -> "kubelwagen"
# Without this, a bare `[^a-z0-9]` strip would delete the umlaut entirely
# ("brummbär" -> "brummbr") and never match the user's "brummbar".
_TRANSLIT = str.maketrans({'ä': 'a', 'ö': 'o', 'ü': 'u', 'ß': 'ss',
                           'Ä': 'a', 'Ö': 'o', 'Ü': 'u'})

def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower().translate(_TRANSLIT))

def load_roster():
    """Returns dict normalized_displayName -> list of (faction, id, displayName)."""
    txt = open(VEHICLES_TS).read()
    rows = {}
    for m in re.finditer(r"V\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'", txt):
        vid, faction, display = m.group(1), m.group(2), m.group(3)
        rows.setdefault(norm(display), []).append((faction, vid, display))
    return rows

# Alpha curve: the source line art is white-on-black, but its anti-aliased
# strokes sit at mid-grey luminance. Mapping alpha = lum 1:1 leaves the body
# of every line semi-transparent, so the icon reads dim/grey against the dark
# glass rail. We floor out near-black noise, then apply gamma<1 + a gain so the
# stroke body lifts to near-opaque white while the outermost edge pixels keep a
# soft alpha falloff (preserves anti-aliasing, avoids jaggies).
ALPHA_FLOOR = 12     # lum <= this is treated as background (dropped)
ALPHA_GAMMA = 0.6    # <1 brightens midtones
ALPHA_GAIN = 1.25    # extra push toward opaque

def key_and_crop(src, out):
    im = Image.open(src).convert('RGB'); w, h = im.size; px = im.load()
    rgba = Image.new('RGBA', (w, h), (0, 0, 0, 0)); rp = rgba.load()
    span = 255 - ALPHA_FLOOR
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]; lum = max(r, g, b)
            if lum <= ALPHA_FLOOR:
                continue
            t = (lum - ALPHA_FLOOR) / span
            a = min(255, round((t ** ALPHA_GAMMA) * 255 * ALPHA_GAIN))
            if a > 0:
                rp[x, y] = (255, 255, 255, a)
    bbox = rgba.getbbox()
    if not bbox:
        return None
    crop = rgba.crop(bbox); cw, ch = crop.size
    pad = int(cw * 0.05)
    canvas = Image.new('RGBA', (cw + 2*pad, ch + 2*pad), (0, 0, 0, 0))
    canvas.paste(crop, (pad, pad), crop)
    tw = 480; th = int(canvas.size[1] * tw / canvas.size[0])
    canvas = canvas.resize((tw, th), Image.LANCZOS)
    canvas.save(out)
    return canvas.size

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.expanduser('~/Documents/icons'))
    args = ap.parse_args()
    roster = load_roster()
    os.makedirs(OUT_DIR, exist_ok=True)
    pngs = [f for f in os.listdir(args.dir) if f.lower().endswith('.png')]
    if not pngs:
        print('No PNGs in', args.dir); return
    for f in sorted(pngs):
        stem = os.path.splitext(f)[0]
        # allow optional "faction_" or "faction " prefix for disambiguation
        key = norm(stem)
        matches = roster.get(key)
        if not matches:
            # try stripping a leading faction token
            for fac in ('german', 'westgerman', 'soviet', 'aef', 'usf', 'british'):
                if key.startswith(fac):
                    sub = roster.get(key[len(fac):])
                    if sub:
                        matches = [m for m in sub if norm(m[0]) == fac] or sub
                        break
        if not matches:
            print(f'SKIP  {f!r}: no display-name match'); continue
        if len(matches) > 1:
            print(f'AMBIG {f!r}: matches {[(m[0], m[1]) for m in matches]} '
                  f'- prefix filename with faction (e.g. "west_german King Tiger.png")')
            continue
        faction, vid, display = matches[0]
        out = os.path.join(OUT_DIR, f'{faction}_{vid}.png')
        size = key_and_crop(os.path.join(args.dir, f), out)
        if size:
            ar = size[0] / size[1]
            print(f'OK    {f!r} -> {faction}_{vid}.png  {size}  aspect {ar:.2f}')
        else:
            print(f'EMPTY {f!r}: no content after keying')

if __name__ == '__main__':
    main()
