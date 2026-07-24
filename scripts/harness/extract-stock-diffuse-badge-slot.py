#!/usr/bin/env python3
"""
extract-stock-diffuse-badge-slot.py
====================================
Read-only investigation script (no source edits).

Extracts and decodes the STOCK vehicle diffuse RGT textures from CoH2's game
SGAs for Tiger I, King Tiger, Sherman Easy 8, and T-34/76, then:

  1. Saves the decoded 2048×2048 PNG to /tmp/coh2-evidence/badge-slot/
  2. Analyses pixel density to locate the national insignia
  3. Compares with the current hand-authored rects in vehicle-uv-registry.ts
     and DEFAULT_BADGE_RECT, printing the delta.

Usage:
  python3 scripts/harness/extract-stock-diffuse-badge-slot.py

Requirements: Pillow (already installed)
"""

import struct, zlib, json, os, sys
from pathlib import Path
from PIL import Image, ImageDraw

# ── Paths ─────────────────────────────────────────────────────────────────────
ARCHIVES_DIR   = Path.home() / ".local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives"
OUTPUT_DIR     = Path("/tmp/coh2-evidence/badge-slot")
REPO_ROOT      = Path(__file__).parent.parent.parent
UV_REGIONS_DIR = REPO_ROOT / "src/lib/vehicle-uv-regions"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# DEFAULT_BADGE_RECT from vehicle-uv-registry.ts (the mean-of-8 fallback)
DEFAULT_BADGE_RECT = {"x": 870, "y": 1150, "w": 320, "h": 312}

VEHICLES = [
    {"id": "tiger",                "faction": "german",
     "sga": "ArtGermanEF.sga",
     "path": "art/armies/german/vehicles/tiger/tiger_dif.rgt"},
    {"id": "king_tiger_sdkfz_182", "faction": "west_german",
     "sga": "ArtWestGerman.sga",
     "path": "art/armies/west_german/vehicles/king_tiger_sdkfz_182/king_tiger_sdkfz_182_dif.rgt"},
    {"id": "m4a3e8_sherman_easy_8","faction": "aef",
     "sga": "ArtAEFSkins.sga",
     "path": "art/armies/aef/vehicles/m4a3e8_sherman_easy_8/m4a3e8_sherman_easy_8_dif.rgt"},
    {"id": "t34_76",               "faction": "soviet",
     "sga": "ArtSovietEF.sga",
     "path": "art/armies/soviet/vehicles/t34_76/t34_76_dif.rgt"},
]

# ── SGA v7 reader ─────────────────────────────────────────────────────────────

def open_sga_v7(sga_path: Path):
    """Open SGA v7. Returns (file_table, raw_bytes).
    file_table maps lowercase slash-path → {abs_data_pos, store_len, raw_len, storage}."""
    data = sga_path.read_bytes()
    assert data[:8] == b"_ARCHIVE"
    major = struct.unpack_from("<H", data, 8)[0]
    assert major == 7, f"Expected SGA v7, got v{major}"

    # Fixed header:
    # 0-7: magic, 8-9: major, 10-11: minor, 12-139: name (128 bytes UTF-16-LE)
    # 140-143: header_size (= TOC byte count)
    # 144-147: data_pos (absolute offset where file payloads start)
    # 148-151: reserved
    data_pos = struct.unpack_from("<I", data, 144)[0]

    # TOC header at 152 (8×u32 = 32 bytes)
    toc_base = 152
    (drive_pos, drive_count,
     folder_pos, folder_count,
     file_pos, file_count,
     name_pos, _) = struct.unpack_from("<8I", data, toc_base)

    name_base = toc_base + name_pos

    def read_name(off: int) -> str:
        start = name_base + off
        end   = data.index(b"\x00", start)
        return data[start:end].decode("utf-8", errors="replace")

    # Build folder path table (folder_idx → full slash-path)
    folder_paths = {}
    for i in range(folder_count):
        base = toc_base + folder_pos + i * 20
        np_, ff, fl, f_first, f_last = struct.unpack_from("<5I", data, base)
        folder_paths[i] = {
            "path":       read_name(np_).replace("\\", "/").lower(),
            "file_first": f_first,
            "file_last":  f_last,
        }

    # Build file→folder map
    file_folder = {}
    for fidx, fd in folder_paths.items():
        for fi in range(fd["file_first"], fd["file_last"] + 1):
            if fi < file_count:
                file_folder[fi] = fd["path"]

    # Build file table
    # FileDef (30 bytes): namePos(4), dataPos(4), storeLen(4), rawLen(4),
    #   mod_time(4), verification(1), storage(1), crc(4), hash_pos(4)
    file_table = {}
    for i in range(file_count):
        base = toc_base + file_pos + i * 30
        name_off, dp, store_len, raw_len = struct.unpack_from("<4I", data, base)
        storage = data[base + 21]
        fname   = read_name(name_off)
        folder  = file_folder.get(i, "")
        full_path = (folder + "/" + fname.lower()) if folder else fname.lower()
        file_table[full_path] = {
            "abs_data_pos": data_pos + dp,
            "store_len":    store_len,
            "raw_len":      raw_len,
            "storage":      storage,
        }

    return file_table, data


def read_file(file_table: dict, raw_data: bytes, path: str) -> bytes | None:
    key   = path.lower().replace("\\", "/")
    entry = file_table.get(key)
    if not entry:
        return None
    start = entry["abs_data_pos"]
    blob  = raw_data[start : start + entry["store_len"]]
    if entry["storage"] in (1, 2):
        try:
            return zlib.decompress(blob)
        except zlib.error:
            return zlib.decompress(blob, -15)
    return blob   # storage=0 → raw, no decompression


# ── Relic Chunky v3 / RGT decoder ────────────────────────────────────────────

def parse_chunky_chunks(buf: bytes, off: int, end: int) -> list:
    chunks = []
    while off < end:
        if off + 28 > end:
            break
        kind     = buf[off:off+4].rstrip(b"\x00").decode("ascii", errors="replace")
        fourcc   = buf[off+4:off+8].rstrip(b"\x00").decode("ascii", errors="replace")
        size     = struct.unpack_from("<I", buf, off + 12)[0]
        name_sz  = struct.unpack_from("<I", buf, off + 16)[0]
        pay_off  = off + 28 + name_sz
        chunks.append({"kind": kind, "fourcc": fourcc,
                        "payload_off": pay_off, "payload_size": size})
        off = pay_off + size
    return chunks


def decode_rgt(rgt_bytes: bytes):
    """Decode CoH2 RGT → (width, height, rgba_bytes, fmt_code). None on fail."""
    if rgt_bytes[:12] != b"Relic Chunky":
        return None
    chunky_ver = struct.unpack_from("<I", rgt_bytes, 16)[0]
    assert chunky_ver == 3
    chunks = parse_chunky_chunks(rgt_bytes, 36, len(rgt_bytes))

    def find(cc):
        for c in chunks:
            if c["fourcc"] == cc:
                return c
        # Also search nested FOLDs (some RGTs wrap in DATAFBIF/DATAFBIF)
        for c in chunks:
            if c["kind"] == "FOLD":
                nested = parse_chunky_chunks(rgt_bytes, c["payload_off"],
                                             c["payload_off"] + c["payload_size"])
                for n in nested:
                    if n["fourcc"] == cc:
                        return n
        return None

    tfmt = find("TFMT"); tman = find("TMAN"); tdat = find("TDAT")
    if not (tfmt and tman and tdat):
        # Try one more level deep
        for c in chunks:
            if c["kind"] == "FOLD":
                nested = parse_chunky_chunks(rgt_bytes, c["payload_off"],
                                             c["payload_off"] + c["payload_size"])
                for n in nested:
                    if n["kind"] == "FOLD":
                        deep = parse_chunky_chunks(rgt_bytes, n["payload_off"],
                                                   n["payload_off"] + n["payload_size"])
                        tfmt = tfmt or next((d for d in deep if d["fourcc"] == "TFMT"), None)
                        tman = tman or next((d for d in deep if d["fourcc"] == "TMAN"), None)
                        tdat = tdat or next((d for d in deep if d["fourcc"] == "TDAT"), None)
        if not (tfmt and tman and tdat):
            return None

    width    = struct.unpack_from("<I", rgt_bytes, tfmt["payload_off"])[0]
    height   = struct.unpack_from("<I", rgt_bytes, tfmt["payload_off"] + 4)[0]
    fmt_code = struct.unpack_from("<I", rgt_bytes, tfmt["payload_off"] + 16)[0]

    mip_count = struct.unpack_from("<I", rgt_bytes, tman["payload_off"])[0]
    cur = tman["payload_off"] + 4
    mips = []
    for _ in range(mip_count):
        unc, cmp = struct.unpack_from("<2I", rgt_bytes, cur); cur += 8
        mips.append((unc, cmp))

    # TDAT: concatenated zlib, smallest mip first → largest last
    skip = sum(c for _, c in mips[:-1])
    last_unc, last_cmp = mips[-1]
    tdat_off = tdat["payload_off"]
    compressed = rgt_bytes[tdat_off + skip : tdat_off + skip + last_cmp]
    try:
        inflated = zlib.decompress(compressed)
    except zlib.error:
        inflated = zlib.decompress(compressed, -15)

    # Strip optional 16-byte per-mip header
    raw = inflated
    if len(raw) >= 16:
        hw = struct.unpack_from("<I", raw, 4)[0]
        hh = struct.unpack_from("<I", raw, 8)[0]
        if hw == width and hh == height:
            raw = raw[16:]

    # Format: 13/22 → BC1, 15/24 → BC3
    FMT = {13: "BC1", 22: "BC1", 15: "BC3", 24: "BC3"}
    codec = FMT.get(fmt_code)
    if codec is None:
        blocks = max(1, (width+3)//4) * max(1, (height+3)//4)
        codec = "BC3" if abs(len(raw) - blocks * 16) < abs(len(raw) - blocks * 8) else "BC1"

    rgba = decode_bc(raw, width, height, codec == "BC3")
    return width, height, rgba, fmt_code


def decode_bc(raw: bytes, W: int, H: int, bc3: bool) -> bytes:
    out  = bytearray(W * H * 4)
    bw   = max(1, (W+3)//4)
    bh   = max(1, (H+3)//4)
    off  = 0
    for by in range(bh):
        for bx in range(bw):
            if bc3:
                a0,a1 = raw[off], raw[off+1]
                apal  = [a0, a1]
                if a0 > a1:
                    for k in range(1,7): apal.append(((7-k)*a0 + k*a1)//7)
                else:
                    for k in range(1,5): apal.append(((5-k)*a0 + k*a1)//5)
                    apal += [0,255]
                lo = raw[off+2]|(raw[off+3]<<8)|(raw[off+4]<<16)
                hi = raw[off+5]|(raw[off+6]<<8)|(raw[off+7]<<16)
                alphas = []
                for i in range(8):  alphas.append(apal[lo&7]); lo>>=3
                for i in range(8):  alphas.append(apal[hi&7]); hi>>=3
                off += 8
            else:
                alphas = [255]*16

            c0 = struct.unpack_from("<H", raw, off)[0]
            c1 = struct.unpack_from("<H", raw, off+2)[0]
            idx_bits = struct.unpack_from("<I", raw, off+4)[0]
            r0,g0,b0 = ((c0>>11)&31)*255//31,((c0>>5)&63)*255//63,(c0&31)*255//31
            r1,g1,b1 = ((c1>>11)&31)*255//31,((c1>>5)&63)*255//63,(c1&31)*255//31
            if c0 > c1:
                pal = [(r0,g0,b0),(r1,g1,b1),
                       ((2*r0+r1)//3,(2*g0+g1)//3,(2*b0+b1)//3),
                       ((r0+2*r1)//3,(g0+2*g1)//3,(b0+2*b1)//3)]
            else:
                pal = [(r0,g0,b0),(r1,g1,b1),((r0+r1)//2,(g0+g1)//2,(b0+b1)//2),(0,0,0)]
            off += 8

            for i in range(16):
                tx = bx*4 + (i%4); ty = by*4 + (i//4)
                if tx >= W or ty >= H: continue
                r,g,b = pal[(idx_bits>>(i*2))&3]
                p = (ty*W+tx)*4
                out[p],out[p+1],out[p+2],out[p+3] = r,g,b,alphas[i]
    return bytes(out)


# ── Insignia detection ────────────────────────────────────────────────────────

def scan_region(img: Image.Image, rx, ry, rw, rh, mode="dark"):
    """Return (cx, cy, bbox_w, bbox_h, count) of dark/bright cluster in region."""
    crop = img.crop((rx, ry, rx+rw, ry+rh)).convert("L")
    px = crop.load()
    xs, ys = [], []
    for y in range(rh):
        for x in range(rw):
            v = px[x, y]
            if (mode == "dark" and v < 50) or (mode == "bright" and v > 200):
                xs.append(x+rx); ys.append(y+ry)
    if len(xs) < 40:
        return None
    return min(xs), min(ys), max(xs)-min(xs), max(ys)-min(ys), len(xs)


def find_balkenkreuz(img: Image.Image, search_rect):
    """Find Balkenkreuz (dark cross) in a search rect. Returns best cluster."""
    rx, ry, rw, rh = search_rect
    return scan_region(img, rx, ry, rw, rh, mode="dark")


def find_star(img: Image.Image, search_rect, mode="bright"):
    """Find US/Soviet star (bright) in a search rect."""
    rx, ry, rw, rh = search_rect
    return scan_region(img, rx, ry, rw, rh, mode=mode)


def find_red_cluster(img: Image.Image, rx, ry, rw, rh):
    """Find red Soviet star pixels."""
    crop = img.crop((rx, ry, rx+rw, ry+rh)).convert("RGB")
    px = crop.load()
    xs, ys = [], []
    for y in range(rh):
        for x in range(rw):
            r, g, b = px[x, y]
            if r > 130 and g < 70 and b < 70:
                xs.append(x+rx); ys.append(y+ry)
    if len(xs) < 20:
        return None
    return min(xs), min(ys), max(xs)-min(xs), max(ys)-min(ys), len(xs)


# ── Load authored JSON rect ───────────────────────────────────────────────────

def load_authored_rect(vehicle_id: str):
    json_path = UV_REGIONS_DIR / f"{vehicle_id}.json"
    if not json_path.exists():
        return None
    with open(json_path) as f:
        d = json.load(f)
    sr = d.get("semanticRegions", {})
    r  = sr.get("hullSideRight") or sr.get("hullFront")
    return {k: v for k, v in r.items() if k in ("x","y","w","h")} if r else None


# ── Per-vehicle processing ────────────────────────────────────────────────────

def process_vehicle(v: dict, findings: list):
    vid     = v["id"]
    faction = v["faction"]
    sga_p   = ARCHIVES_DIR / v["sga"]

    print(f"\n{'='*70}")
    print(f"Vehicle: {vid}  faction={faction}")
    print(f"SGA:     {sga_p.name}")

    if not sga_p.exists():
        print(f"  SGA not found — skipping")
        findings.append({"vehicle": vid, "error": "SGA not found"})
        return

    print(f"  Parsing SGA TOC...")
    file_table, raw_data = open_sga_v7(sga_p)
    print(f"  {len(file_table)} files in archive")

    rgt_bytes = read_file(file_table, raw_data, v["path"])
    if rgt_bytes is None:
        # List available dif.rgt files for this vehicle
        candidates = [k for k in file_table if vid.replace("_","") in k.replace("_","") and "_dif.rgt" in k]
        print(f"  Canonical path not found. Candidates: {candidates[:5]}")
        if candidates:
            rgt_bytes = read_file(file_table, raw_data, candidates[0])
            v["path"] = candidates[0]
    if rgt_bytes is None:
        print(f"  ERROR: cannot read RGT")
        findings.append({"vehicle": vid, "error": "RGT not found"})
        return

    print(f"  RGT: {len(rgt_bytes):,} bytes  →  decoding...")
    result = decode_rgt(rgt_bytes)
    if result is None:
        print(f"  ERROR: decode failed")
        findings.append({"vehicle": vid, "error": "decode failed"})
        return

    img_w, img_h, rgba, fmt_code = result
    print(f"  Decoded: {img_w}×{img_h}  fmt={fmt_code} ({'BC1' if fmt_code in (13,22) else 'BC3'})")

    img = Image.frombytes("RGBA", (img_w, img_h), rgba)

    out_png = OUTPUT_DIR / f"{vid}_stock_diffuse.png"
    img.save(str(out_png))
    print(f"  Saved: {out_png.name}")

    authored = load_authored_rect(vid)
    print(f"  Authored rect: {authored}")

    # Detect insignia — vehicle-specific search regions based on authored rect + UV data
    # For each vehicle, we search in the known hull-right-side zone.
    # German vehicles: Balkenkreuz (dark cross on lighter background)
    # AEF: US white star (bright on darker background)
    # Soviet: Red star (high R, low G/B)
    insignia = None

    if faction in ("german", "west_german"):
        # Use authored rect as search anchor; also try the wider hull-right zone
        search_zones = []
        if authored:
            ax,ay,aw,ah = authored["x"], authored["y"], authored["w"], authored["h"]
            margin = 200
            search_zones.append((max(0,ax-margin), max(0,ay-margin),
                                  min(img_w, aw+margin*2), min(img_h, ah+margin*2)))
        # Also search known hull-right band from king_tiger_sdkfz_182.json notes:
        # x=400-1000, y=1300-1700 for German vehicles
        search_zones.append((300, 1100, 900, 700))

        for zone in search_zones:
            res = find_balkenkreuz(img, zone)
            if res:
                bx,by,bw,bh,cnt = res
                # Filter out tiny noise clusters
                if bw > 30 and bh > 30:
                    insignia = {"x": bx, "y": by, "w": bw, "h": bh, "pixel_count": cnt,
                                "method": "dark_cluster_balkenkreuz"}
                    print(f"  Balkenkreuz at ({bx},{by}) size={bw}×{bh}  pixels={cnt}")
                    break

    elif faction == "aef":
        # US white star: bright cluster in hull-right zone
        search_zones = []
        if authored:
            ax,ay,aw,ah = authored["x"], authored["y"], authored["w"], authored["h"]
            margin = 200
            search_zones.append((max(0,ax-margin), max(0,ay-margin),
                                  min(img_w, aw+margin*2), min(img_h, ah+margin*2)))
        search_zones.append((1500, 1100, 500, 600))  # Sherman Easy 8 hull-right

        for zone in search_zones:
            res = find_star(img, zone, mode="bright")
            if res:
                sx,sy,sw,sh,cnt = res
                if sw > 30 and sh > 30:
                    insignia = {"x": sx, "y": sy, "w": sw, "h": sh, "pixel_count": cnt,
                                "method": "bright_cluster_star"}
                    print(f"  US star at ({sx},{sy}) size={sw}×{sh}  pixels={cnt}")
                    break

    elif faction == "soviet":
        # Soviet red star
        search_zones = []
        if authored:
            ax,ay,aw,ah = authored["x"], authored["y"], authored["w"], authored["h"]
            margin = 150
            search_zones.append((max(0,ax-margin), max(0,ay-margin),
                                  min(img_w, aw+margin*2), min(img_h, ah+margin*2)))
        search_zones.append((0, 280, 400, 400))  # T-34/76 hull-front zone

        for zone in search_zones:
            rx,ry,rw,rh = zone
            res = find_red_cluster(img, rx, ry, rw, rh)
            if res:
                sx,sy,sw,sh,cnt = res
                if sw > 15 and sh > 15:
                    insignia = {"x": sx, "y": sy, "w": sw, "h": sh, "pixel_count": cnt,
                                "method": "red_pixels_soviet_star"}
                    print(f"  Soviet star at ({sx},{sy}) size={sw}×{sh}  pixels={cnt}")
                    break
        if not insignia:
            # Fallback: bright cluster
            for zone in search_zones:
                res = find_star(img, zone, mode="bright")
                if res:
                    sx,sy,sw,sh,cnt = res
                    if sw > 15 and sh > 15:
                        insignia = {"x": sx, "y": sy, "w": sw, "h": sh, "pixel_count": cnt,
                                    "method": "bright_fallback"}
                        print(f"  Soviet star (bright fallback) at ({sx},{sy}) size={sw}×{sh}")
                        break

    if insignia is None:
        print(f"  WARNING: no insignia detected in stock diffuse")

    # Build annotated atlas image
    ann = img.copy().convert("RGBA")
    draw = ImageDraw.Draw(ann)
    if insignia:
        ix,iy,iw,ih = insignia["x"],insignia["y"],insignia["w"],insignia["h"]
        draw.rectangle([ix,iy, ix+iw,iy+ih], outline=(0,255,0,255), width=5)
    if authored:
        ax,ay,aw,ah = authored["x"],authored["y"],authored["w"],authored["h"]
        draw.rectangle([ax,ay, ax+aw,ay+ah], outline=(255,0,0,255), width=5)
    # Draw DEFAULT_BADGE_RECT in yellow
    d = DEFAULT_BADGE_RECT
    draw.rectangle([d["x"],d["y"], d["x"]+d["w"],d["y"]+d["h"]], outline=(255,255,0,255), width=3)
    ann_png = OUTPUT_DIR / f"{vid}_annotated.png"
    ann.save(str(ann_png))
    print(f"  Annotated: {ann_png.name}  (green=detected, red=authored, yellow=DEFAULT)")

    # Save badge-zone crop around authored rect
    if authored:
        cx,cy = authored["x"]+authored["w"]//2, authored["y"]+authored["h"]//2
        m = 350
        crop = img.crop((max(0,cx-m),max(0,cy-m), min(img_w,cx+m),min(img_h,cy+m)))
        crop_png = OUTPUT_DIR / f"{vid}_badge_zone.png"
        crop.save(str(crop_png))
        print(f"  Badge-zone crop: {crop_png.name}")

    # Comparison metrics
    comp = None
    if insignia and authored:
        ix,iy,iw,ih = insignia["x"],insignia["y"],insignia["w"],insignia["h"]
        ax,ay,aw,ah = authored["x"],authored["y"],authored["w"],authored["h"]
        dcx,dcy = ix+iw//2, iy+ih//2
        acx,acy = ax+aw//2, ay+ah//2
        dist = ((dcx-acx)**2 + (dcy-acy)**2)**0.5
        comp = {
            "detected_centroid": [dcx, dcy],
            "authored_centroid": [acx, acy],
            "centroid_px_delta": round(dist,1),
            "detected_size":  [iw, ih],
            "authored_size":  [aw, ah],
            "size_ratio_w":   round(iw/aw,2) if aw else None,
            "size_ratio_h":   round(ih/ah,2) if ah else None,
        }
        print(f"  Centroid delta: {comp['centroid_px_delta']}px  "
              f"detected={iw}×{ih}  authored={aw}×{ah}")

    # Compare authored vs DEFAULT
    def_comp = None
    if authored:
        ax,ay,aw,ah = authored["x"],authored["y"],authored["w"],authored["h"]
        dx,dy,dw,dh = DEFAULT_BADGE_RECT["x"],DEFAULT_BADGE_RECT["y"],DEFAULT_BADGE_RECT["w"],DEFAULT_BADGE_RECT["h"]
        acx,acy = ax+aw//2, ay+ah//2
        def_cx,def_cy = dx+dw//2, dy+dh//2
        dist = ((acx-def_cx)**2 + (acy-def_cy)**2)**0.5
        def_comp = {
            "default_centroid":  [def_cx, def_cy],
            "authored_centroid": [acx, acy],
            "centroid_delta_px": round(dist,1),
            "default_size":  [dw, dh],
            "authored_size": [aw, ah],
        }
        print(f"  Authored vs DEFAULT centroid delta: {def_comp['centroid_delta_px']}px")

    findings.append({
        "vehicle":         vid,
        "faction":         faction,
        "atlas_size":      [img_w, img_h],
        "format_code":     fmt_code,
        "authored_rect":   authored,
        "default_rect":    DEFAULT_BADGE_RECT,
        "detected_insignia": insignia,
        "comparison_to_authored": comp,
        "default_vs_authored": def_comp,
        "output_png":      str(out_png),
    })


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"CoH2 Archives: {ARCHIVES_DIR}")
    print(f"Output dir:    {OUTPUT_DIR}")

    if not ARCHIVES_DIR.exists():
        print(f"ERROR: Archives dir not found", file=sys.stderr)
        sys.exit(1)

    findings = []
    for v in VEHICLES:
        try:
            process_vehicle(v, findings)
        except Exception as e:
            import traceback
            print(f"  EXCEPTION: {e}")
            traceback.print_exc()
            findings.append({"vehicle": v["id"], "error": str(e)})

    findings_path = OUTPUT_DIR / "findings.json"
    with open(findings_path, "w") as f:
        json.dump(findings, f, indent=2)

    print(f"\n{'='*70}\nSUMMARY\n{'='*70}")
    for f in findings:
        vid = f["vehicle"]
        if "error" in f:
            print(f"  {vid}: ERROR — {f['error']}")
            continue
        print(f"  {vid} ({f['faction']}):")
        ar = f.get("authored_rect")
        di = f.get("detected_insignia")
        co = f.get("comparison_to_authored")
        dc = f.get("default_vs_authored")
        print(f"    atlas           : {f['atlas_size']}")
        print(f"    authored rect   : {ar}")
        if di:
            print(f"    detected mark   : ({di['x']},{di['y']}) {di['w']}×{di['h']}  method={di['method']}")
        if co:
            print(f"    authored delta  : {co['centroid_px_delta']}px centroid  size ratio {co['size_ratio_w']}×{co['size_ratio_h']}")
        if dc:
            print(f"    default→authored: {dc['centroid_delta_px']}px apart")

    print(f"\nFindings JSON: {findings_path}")

if __name__ == "__main__":
    main()
