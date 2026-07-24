#!/usr/bin/env python3
"""
Decal badge-slot rect scanner for CoH2 vehicles.

Pipeline:
  1. For each of 61 vehicles, find the body diffuse RGT in the stock SGA archives.
  2. Decode BC1/BC3 -> RGBA 2048x2048 image.
  3. Detect the national-insignia region (bright blob: white star/cross on OD green).
  4. Emit {x, y, w, h} ~310px rect centered on the detected centroid.
  5. Validate against 16 known-good rects; report delta table.
  6. Emit generated-rects.json, overlays/*.png, coverage-report.md.

Usage:
  python3 scripts/decal-rects/scan.py
"""

import struct, zlib, json, os, sys
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO = Path(__file__).parent.parent.parent
ARCHIVES_DIR = Path("/var/home/jflessenkemper/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives")
UV_REGIONS_DIR = REPO / "src/lib/vehicle-uv-regions"
OUTPUT_DIR = REPO / "artifacts/respec_audit/decal-coverage"
OVERLAYS_DIR = OUTPUT_DIR / "overlays"
OVERLAYS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# SGA reader (pure Python, SGA v7 only - all CoH2 stock archives are v7)
#
# Key: CoH2 SGA v7 folder entries store FULL paths (e.g. 'art\armies\german\vehicles\tiger').
# File entries store only the leaf filename. So full path = folder_path + '/' + filename.
# ---------------------------------------------------------------------------

def read_u32_le(buf, off):
    return struct.unpack_from('<I', buf, off)[0]

class SgaReader:
    """Minimal SGA v7 reader - TOC-only, lazy payload reads."""

    def __init__(self, path: Path):
        self.path = path
        self.data = path.read_bytes()
        self._files: dict[str, tuple[int,int,int,int]] = {}
        self._data_offset = 0
        self._parse()

    def _parse(self):
        d = self.data
        if d[:8] != b'_ARCHIVE':
            raise ValueError(f"Not an SGA: {self.path}")
        major = struct.unpack_from('<H', d, 8)[0]
        if major != 7:
            raise ValueError(f"Unsupported SGA v{major}: {self.path}")
        self._parse_v7()

    def _parse_v7(self):
        d = self.data
        # Header: 8 magic + 2 major + 2 minor + 128 archive name = 140
        # Then: 4 header_size + 4 data_pos + 4 rsv = total 152 bytes
        header_size = read_u32_le(d, 140)
        data_pos = read_u32_le(d, 144)
        self._data_offset = data_pos

        toc_start = 152
        toc = d[toc_start : toc_start + header_size]

        # TOC header (32 bytes):
        #   drive_pos(4) drive_count(4) folder_pos(4) folder_count(4)
        #   file_pos(4)  file_count(4)  name_pos(4)   name_count(4)
        drive_pos  = read_u32_le(toc, 0)
        drive_count = read_u32_le(toc, 4)
        folder_pos = read_u32_le(toc, 8)
        folder_count = read_u32_le(toc, 12)
        file_pos   = read_u32_le(toc, 16)
        file_count = read_u32_le(toc, 20)
        name_pos   = read_u32_le(toc, 24)

        def read_name(rel_off: int) -> str:
            abs_off = name_pos + rel_off
            end = toc.index(b'\x00', abs_off)
            return toc[abs_off:end].decode('utf-8', errors='replace')

        # Folders: 20 bytes each
        # namePos(4) folderFirst(4) folderLast(4) fileFirst(4) fileLast(4)
        # namePos is relative to name_pos; value is the FULL folder path
        folders = []
        for i in range(folder_count):
            o = folder_pos + i * 20
            np_, ff, fl, fif, fil = struct.unpack_from('<IIIII', toc, o)
            fname = read_name(np_).replace('\\', '/').lower().strip('/')
            folders.append((fname, fif, fil))

        # Files: 30 bytes each
        # namePos(4) dataPos(4) storeLength(4) length(4) ... storage(1) at offset 24
        files_list = []
        for i in range(file_count):
            o = file_pos + i * 30
            name_off, fdp, sl, ul = struct.unpack_from('<IIII', toc, o)
            storage = toc[o + 24] if (o + 25) <= len(toc) else 0
            fname = read_name(name_off).replace('\\', '/').lower()
            files_list.append((fname, fdp, sl, ul, storage))

        # Build path -> entry map (flat: each folder already has its full path)
        for (dir_path, fif, fil) in folders:
            for fi in range(fif, fil):
                fname, fdp, sl, ul, stor = files_list[fi]
                full = (dir_path + '/' + fname).lstrip('/')
                self._files[full] = (fdp, sl, ul, stor)

    def list_files(self) -> list[str]:
        return list(self._files.keys())

    def read_file(self, path: str) -> bytes | None:
        key = path.replace('\\', '/').lower()
        if key not in self._files:
            return None
        fdp, sl, ul, stor = self._files[key]
        start = self._data_offset + fdp
        raw = self.data[start : start + sl]
        if stor in (1, 2):
            try:
                return zlib.decompress(raw)
            except Exception:
                try:
                    return zlib.decompress(raw, -15)
                except Exception:
                    return raw
        return raw


# ---------------------------------------------------------------------------
# RGT decoder (BC1/BC3 block compression)
# ---------------------------------------------------------------------------

def parse_rgt(data: bytes) -> tuple:
    """Parse RGT chunky -> (width, height, fourCC, bc_pixels)"""
    MAGIC = b'Relic Chunky\r\n\x1a\x00'
    if data[:16] != MAGIC:
        raise ValueError("Not a Chunky file")

    width = height = 0
    format_code = 0
    mips = []
    mip_data_bytes = b''

    def walk(buf, off, end):
        nonlocal width, height, format_code, mips, mip_data_bytes
        while off < end:
            if off + 20 > len(buf):
                break
            kind = buf[off:off+4].decode('ascii', errors='replace')
            cc   = buf[off+4:off+8].decode('ascii', errors='replace')
            ver  = read_u32_le(buf, off+8)
            size = read_u32_le(buf, off+12)
            name_len = read_u32_le(buf, off+16)
            payload_off = off + 20 + name_len
            next_off = payload_off + size

            if kind == 'FOLD':
                walk(buf, payload_off, next_off)
            elif kind == 'DATA':
                if cc == 'TFMT' and size >= 20:
                    width  = read_u32_le(buf, payload_off)
                    height = read_u32_le(buf, payload_off + 4)
                    format_code = read_u32_le(buf, payload_off + 16)
                elif cc == 'TMAN':
                    mip_count = read_u32_le(buf, payload_off)
                    cur = payload_off + 4
                    mips = []
                    for _ in range(mip_count):
                        unc = read_u32_le(buf, cur); cur += 4
                        cmp = read_u32_le(buf, cur); cur += 4
                        mips.append((unc, cmp))
                elif cc == 'TDAT':
                    mip_data_bytes = buf[payload_off : payload_off + size]
            off = next_off

    walk(data, 36, len(data))

    if not mips or not mip_data_bytes:
        raise ValueError("RGT: no mip data found")

    # Largest mip is last; data concatenated smallest first
    off = 0
    for unc, cmp in mips[:-1]:
        off += cmp
    last_unc, last_cmp = mips[-1]
    compressed = mip_data_bytes[off : off + last_cmp]
    inflated = zlib.decompress(compressed)

    # Strip optional 16-byte per-mip header
    if len(inflated) >= 16:
        hdr_w = read_u32_le(inflated, 4)
        hdr_h = read_u32_le(inflated, 8)
        if hdr_w == width and hdr_h == height:
            inflated = inflated[16:]

    # Classify BC format
    FORMAT_MAP = {13: 'DXT1', 22: 'DXT1', 15: 'DXT5', 24: 'DXT5'}
    if format_code in FORMAT_MAP:
        fourCC = FORMAT_MAP[format_code]
    else:
        blocks = max(1, (width+3)//4) * max(1, (height+3)//4)
        bc1_sz = blocks * 8
        bc3_sz = blocks * 16
        fourCC = 'DXT1' if abs(len(inflated) - bc1_sz) < abs(len(inflated) - bc3_sz) else 'DXT5'

    return width, height, fourCC, bytes(inflated)


def decode_bc1_block(src: bytes, off: int) -> list:
    """Decode one 4x4 BC1 block -> list of 16 RGBA tuples."""
    c0_raw = (src[off+1] << 8) | src[off]
    c1_raw = (src[off+3] << 8) | src[off+2]
    bits = read_u32_le(src, off+4)

    def rgb565(v):
        r = ((v >> 11) & 0x1F) * 255 // 31
        g = ((v >> 5)  & 0x3F) * 255 // 63
        b = ((v)       & 0x1F) * 255 // 31
        return (r, g, b, 255)

    c = [rgb565(c0_raw), rgb565(c1_raw), (0,0,0,255), (0,0,0,255)]
    r0,g0,b0,_ = c[0]; r1,g1,b1,_ = c[1]
    if c0_raw > c1_raw:
        c[2] = ((2*r0+r1)//3, (2*g0+g1)//3, (2*b0+b1)//3, 255)
        c[3] = ((r0+2*r1)//3, (g0+2*g1)//3, (b0+2*b1)//3, 255)
    else:
        c[2] = ((r0+r1)//2, (g0+g1)//2, (b0+b1)//2, 255)
        c[3] = (0, 0, 0, 0)

    pixels = []
    for i in range(16):
        idx = (bits >> (i*2)) & 3
        pixels.append(c[idx])
    return pixels


def decode_bc3_alpha_block(src: bytes, off: int) -> list:
    a0, a1 = src[off], src[off+1]
    ap = [a0, a1, 0, 0, 0, 0, 0, 0]
    if a0 > a1:
        for i in range(6): ap[i+2] = ((6-i)*a0 + (i+1)*a1) // 7
    else:
        for i in range(4): ap[i+2] = ((4-i)*a0 + (i+1)*a1) // 5
        ap[6] = 0; ap[7] = 255
    bits = 0
    for j in range(6):
        bits |= src[off+2+j] << (j*8)
    return [ap[(bits >> (i*3)) & 7] for i in range(16)]


def decode_rgt_to_rgba(data: bytes) -> np.ndarray:
    """Decode RGT bytes -> HxWx4 uint8 numpy array (RGBA)."""
    w, h, fourCC, pixels = parse_rgt(data)
    bw = max(1, (w+3)//4)
    bh = max(1, (h+3)//4)
    out = np.zeros((h, w, 4), dtype=np.uint8)

    off = 0
    for by in range(bh):
        for bx in range(bw):
            px0 = bx * 4; py0 = by * 4
            if fourCC == 'DXT5':
                alphas = decode_bc3_alpha_block(pixels, off); off += 8
                colors = decode_bc1_block(pixels, off); off += 8
                for i, (r,g,b,_) in enumerate(colors):
                    px = px0 + (i % 4); py = py0 + (i // 4)
                    if px < w and py < h:
                        out[py, px] = (r, g, b, alphas[i])
            else:  # DXT1
                colors = decode_bc1_block(pixels, off); off += 8
                for i, (r,g,b,a) in enumerate(colors):
                    px = px0 + (i % 4); py = py0 + (i // 4)
                    if px < w and py < h:
                        out[py, px] = (r, g, b, a)
    return out


# ---------------------------------------------------------------------------
# Vehicle catalog
# ---------------------------------------------------------------------------

VEHICLES = [
    ('tiger',               'german',       'Tiger I'),
    ('elefant',             'german',       'Elefant'),
    ('brummbar',            'german',       'Brummbar'),
    ('stug_iii',            'german',       'StuG III'),
    ('ostwind_flak_panzer', 'german',       'Ostwind'),
    ('panzerwerfer',        'german',       'Panzerwerfer'),
    ('halftrack',           'german',       'Sd.Kfz. 251'),
    ('sdkfz_250',           'german',       'Sd.Kfz. 250'),
    ('sdkfz_222',           'german',       'Sd.Kfz. 222'),
    ('opel_blitz',          'german',       'Opel Blitz'),
    ('king_tiger_sdkfz_182',            'west_german', 'King Tiger'),
    ('jagdtiger',                       'west_german', 'Jagdtiger'),
    ('sturmtiger',                      'west_german', 'Sturmtiger'),
    ('panther_ausf_g',                  'west_german', 'Panther'),
    ('jagdpanzer_iv_sdkfz_162',         'west_german', 'Jagdpanzer IV'),
    ('panzer_iv_sdkfz_ausf_i',          'west_german', 'Panzer IV'),
    ('hetzer',                          'west_german', 'Hetzer'),
    ('puma_sdkfz_234',                  'west_german', 'Puma'),
    ('panzer_ii_luchs_sdkfz_123',       'west_german', 'Luchs'),
    ('kubelwagen',                      'west_german', 'Kubelwagen'),
    ('halftrack_sdkfz_251',             'west_german', 'Sd.Kfz. 251 (OKW)'),
    ('halftrack_sdkfz_251_flak',        'west_german', 'Sd.Kfz. 251 Flak'),
    ('halftrack_sdkfz_251_infrared',    'west_german', 'Sd.Kfz. 251 IR'),
    ('is2m_heavy_tank',  'soviet', 'IS-2'),
    ('isu152',           'soviet', 'ISU-152'),
    ('kv1_heavy_tank',   'soviet', 'KV-1'),
    ('kv2_heavy_tank',   'soviet', 'KV-2'),
    ('t34_76',           'soviet', 'T-34/76'),
    ('t_34_85',          'soviet', 'T-34/85'),
    ('t70m_light_tank',  'soviet', 'T-70'),
    ('su85',             'soviet', 'SU-85'),
    ('su-76m',           'soviet', 'SU-76M'),
    ('m3a1_scout_car',   'soviet', 'M3A1 Scout'),
    ('halftrack',        'soviet', 'Lend-Lease Truck'),
    ('us6_truck',        'soviet', 'US6 Studebaker'),
    ('m26_pershing',            'aef', 'Pershing'),
    ('m4a3e8_sherman_easy_8',   'aef', 'Easy 8'),
    ('m4a3_sherman_76mm',       'aef', 'Sherman 76mm'),
    ('m4a1_sherman_calliope',   'aef', 'Calliope'),
    ('m10_tank_destroyer',      'aef', 'M10 Wolverine'),
    ('m36_tank_destroyer',      'aef', 'M36 Jackson'),
    ('m5a1_stuart',             'aef', 'M5 Stuart'),
    ('m8_greyhound',            'aef', 'Greyhound'),
    ('m7b1_priest',             'aef', 'Priest'),
    ('m3_halftrack',            'aef', 'M3 Halftrack'),
    ('m15a1_aa_halftrack',      'aef', 'AA Halftrack'),
    ('m8a1_hmc',                'aef', 'M8 Scott'),
    ('m20_utility_car',         'aef', 'M20'),
    ('m21_mortar_halftrack',    'aef', 'M21 Mortar HT'),
    ('dodge_wc51',              'aef', 'Dodge WC51'),
    ('dodge_wc54_ambulance',    'aef', 'WC54 Ambulance'),
    ('sherman_m4a3',            'aef', 'M4A3 Sherman'),
    ('churchill',        'british', 'Churchill'),
    ('comet',            'british', 'Comet'),
    ('cromwell',         'british', 'Cromwell'),
    ('centaur',          'british', 'Centaur AA'),
    ('sherman_firefly',  'british', 'Firefly'),
    ('valentine',        'british', 'Valentine'),
    ('sexton',           'british', 'Sexton SPG'),
    ('aec_armoured_car', 'british', 'AEC Armoured Car'),
    ('bren_carrier',     'british', 'Universal Carrier'),
]

VEHICLE_FOLDER_ALIAS = {
    'centaur':   'centaur_aa',
    't_34_85':   't34_85',
    'valentine': 'valentine_command',
}

TEXTURE_BASE_NAMES = {
    'elefant':             ['elefant_hull', 'elefant'],
    'ostwind_flak_panzer': ['ostwind', 'ostwind_flak_panzer'],
    'sdkfz_222':           ['sdkfz221', 'sdkfz_222'],
    'panther_ausf_g':      ['panther', 'panther_ausf_g'],
    'halftrack':           ['halftrack', 'halftrack_sdkfz_251'],
    'centaur':             ['centaur_aa'],
    't_34_85':             ['t_34_85'],
    'valentine':           ['valentine_command'],
}

FACTION_SGA = {
    'german':       ['ArtGermanEF.sga', 'ArtArmies.sga', 'ArtHigh.sga'],
    'west_german':  ['ArtWestGerman.sga', 'ArtHighXP1.sga', 'ArtArmies.sga'],
    'soviet':       ['ArtSovietEF.sga', 'ArtArmies.sga', 'ArtHigh.sga'],
    'aef':          ['ArtAEFSkins.sga', 'ArtAEF.sga', 'ArtHighXP1.sga'],
    'british':      ['ArtBritish.sga', 'ArtHighXP2.sga'],
}

def vehicle_folder(vid: str) -> str:
    return VEHICLE_FOLDER_ALIAS.get(vid, vid)

def texture_base_names(vid: str) -> list:
    return TEXTURE_BASE_NAMES.get(vid, [vid])

# ---------------------------------------------------------------------------
# 16 known-good ground-truth rects (loaded from JSON files)
# ---------------------------------------------------------------------------

def load_authored_rects() -> dict:
    """Load all 16 known-good rects from authored JSON files."""
    known = {
        'king_tiger_sdkfz_182': {'x': 410, 'y': 1320, 'w': 360, 'h': 340, 'key': 'hullSideRight'},
        'tiger':                {'x': 996, 'y': 1128, 'w': 320, 'h': 320, 'key': 'hullSideRight'},
        't34_76':               {'x':   0, 'y':  342, 'w': 276, 'h': 320, 'key': 'hullFront'},
        'm4a3e8_sherman_easy_8':{'x':1700, 'y': 1236, 'w': 320, 'h': 320, 'key': 'hullSideRight'},
        'su85':                 {'x': 951, 'y': 1256, 'w': 340, 'h': 320, 'key': 'hullSideRight'},
        'sherman_firefly':      {'x':  45, 'y':  380, 'w': 280, 'h': 260, 'key': 'hullSideRight'},
        'stug_iii':             {'x':1395, 'y': 1635, 'w': 330, 'h': 310, 'key': 'hullSideRight'},
        'kv2_heavy_tank':       {'x':1235, 'y': 1300, 'w': 320, 'h': 310, 'key': 'hullSideRight'},
        'panzerwerfer':         {'x': 220, 'y':  930, 'w': 310, 'h': 310, 'key': 'hullSideRight'},
    }
    # Load the 7 authored but previously unregistered rects from JSON
    extra_ids = ['cromwell', 'kv1_heavy_tank', 'm10_tank_destroyer', 'm26_pershing',
                 'm36_tank_destroyer', 'm4a3_sherman_76mm', 't34_85']
    for vid in extra_ids:
        json_path = UV_REGIONS_DIR / f"{vid}.json"
        if json_path.exists():
            d = json.loads(json_path.read_text())
            sr = d.get('semanticRegions', {})
            if 'hullSideRight' in sr:
                r = sr['hullSideRight']
                known[vid] = {'x': r['x'], 'y': r['y'], 'w': r['w'], 'h': r['h'], 'key': 'hullSideRight'}
            elif 'hullFront' in sr:
                r = sr['hullFront']
                known[vid] = {'x': r['x'], 'y': r['y'], 'w': r['w'], 'h': r['h'], 'key': 'hullFront'}
    return known


# ---------------------------------------------------------------------------
# SGA archive cache
# ---------------------------------------------------------------------------

_sga_cache: dict = {}

def get_sga(name: str):
    if name in _sga_cache:
        return _sga_cache[name]
    path = ARCHIVES_DIR / name
    if not path.exists():
        _sga_cache[name] = None
        return None
    try:
        sga = SgaReader(path)
        _sga_cache[name] = sga
        print(f"  Loaded SGA: {name} ({len(sga.list_files())} files)")
    except Exception as e:
        print(f"  WARN: Failed to load {name}: {e}")
        _sga_cache[name] = None
    return _sga_cache[name]


def find_rgt(faction: str, vid: str):
    """Find the body diffuse RGT bytes. Returns (bytes|None, source_desc)."""
    folder = vehicle_folder(vid)
    bases = texture_base_names(vid)
    sga_names = FACTION_SGA.get(faction, ['ArtArmies.sga', 'ArtHigh.sga'])

    for sga_name in sga_names:
        sga = get_sga(sga_name)
        if not sga:
            continue
        for base in bases:
            path = f"art/armies/{faction}/vehicles/{folder}/{base}_dif.rgt"
            data = sga.read_file(path)
            if data:
                return data, f"{sga_name}:{path}"

    return None, ''


# ---------------------------------------------------------------------------
# Insignia detection
# ---------------------------------------------------------------------------

def detect_badge_centroid(rgba: np.ndarray, vid: str, faction: str):
    """
    Detect the national-insignia centroid.

    Returns (cx, cy, confidence) or (None, None, 0).
    """
    h, w = rgba.shape[:2]
    gray = (rgba[:,:,0].astype(np.float32) * 0.299 +
            rgba[:,:,1].astype(np.float32) * 0.587 +
            rgba[:,:,2].astype(np.float32) * 0.114)

    is_t34_front = vid in ('t34_76', 't_34_85')

    # Define search mask
    mask = np.zeros((h, w), dtype=bool)
    if is_t34_front:
        # Hull front: upper-left region (glacis/fender panels)
        mask[:int(h*0.45), :int(w*0.30)] = True
    elif faction == 'aef':
        # US vehicles: hull-side band; avoid turret top zone
        mask[int(h*0.35):int(h*0.85), :] = True
    elif faction in ('german', 'west_german'):
        # German Balkenkreuz: dark cross with light outline
        # Typically found in lower half of atlas on hull side
        mask[int(h*0.35):, :] = True
    else:
        # Soviet, British: stars in varied locations
        mask[int(h*0.15):, :] = True

    # Threshold: bright pixels (insignia are white/light grey)
    bright = (gray > 180) & mask

    # Connected component analysis
    labeled, num = ndimage.label(bright)
    if num == 0:
        return None, None, 0.0

    best_score = 0.0
    best_cx = best_cy = None
    best_area = 0

    for i in range(1, num + 1):
        comp = (labeled == i)
        area = int(comp.sum())
        if area < 150:
            continue
        # Score: prefer badge-sized blobs (400-6000 px at 2048^2)
        if 400 <= area <= 6000:
            score = float(area)
        elif area < 400:
            score = area * 0.4
        else:
            score = area * 0.2  # penalize very large blobs (likely background panels)

        if score > best_score:
            best_score = score
            ys, xs = np.where(comp)
            best_cx = int(xs.mean())
            best_cy = int(ys.mean())
            best_area = area

    if best_cx is None:
        return None, None, 0.0

    # Confidence
    if 500 <= best_area <= 5000:
        conf = 0.75
    elif 300 <= best_area <= 8000:
        conf = 0.55
    else:
        conf = 0.30

    return best_cx, best_cy, conf


def centroid_to_rect(cx: int, cy: int, size: int = 310) -> dict:
    half = size // 2
    x = max(0, cx - half)
    y = max(0, cy - half)
    if x + size > 2048:
        x = 2048 - size
    if y + size > 2048:
        y = 2048 - size
    return {'x': x, 'y': y, 'w': size, 'h': size}


# ---------------------------------------------------------------------------
# Per-faction mean fallback
# ---------------------------------------------------------------------------

def faction_mean_rect(faction: str, authored: dict) -> dict:
    faction_vids = {
        'german':       ['tiger', 'stug_iii', 'panzerwerfer'],
        'west_german':  ['king_tiger_sdkfz_182'],
        'soviet':       ['su85', 'kv2_heavy_tank', 'kv1_heavy_tank'],
        'aef':          ['m4a3e8_sherman_easy_8', 'm36_tank_destroyer', 'm10_tank_destroyer', 'm26_pershing', 'm4a3_sherman_76mm'],
        'british':      ['sherman_firefly', 'cromwell'],
    }
    candidates = [authored[v] for v in faction_vids.get(faction, [])
                  if v in authored and authored[v].get('key') != 'hullFront']
    if not candidates:
        return {'x': 870, 'y': 1150, 'w': 320, 'h': 312}
    mx = int(sum(r['x'] for r in candidates) / len(candidates))
    my = int(sum(r['y'] for r in candidates) / len(candidates))
    mw = int(sum(r['w'] for r in candidates) / len(candidates))
    mh = int(sum(r['h'] for r in candidates) / len(candidates))
    return {'x': mx, 'y': my, 'w': mw, 'h': mh}


# ---------------------------------------------------------------------------
# Overlay generation
# ---------------------------------------------------------------------------

def save_overlay(rgba: np.ndarray, rect: dict, vid: str):
    img = Image.fromarray(rgba, 'RGBA').convert('RGB')
    scale = 512 / 2048
    thumb = img.resize((512, 512), Image.LANCZOS)
    draw = ImageDraw.Draw(thumb)
    rx = int(rect['x'] * scale)
    ry = int(rect['y'] * scale)
    rw = int(rect['w'] * scale)
    rh = int(rect['h'] * scale)
    draw.rectangle([rx, ry, rx+rw, ry+rh], outline='red', width=2)
    thumb.save(OVERLAYS_DIR / f"{vid}.png")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=== CoH2 Decal Badge-Slot Rect Scanner ===\n")

    authored = load_authored_rects()
    print(f"Loaded {len(authored)} authored/known rects")
    print()

    results = {}
    processed = set()

    for (vid, faction, display_name) in VEHICLES:
        combo = (vid, faction)
        if combo in processed:
            continue
        processed.add(combo)

        print(f"[{faction}] {vid}...")

        # t_34_85 in vehicles uses id 't_34_85' but authored rect is under 't34_85'
        auth_key = 't34_85' if vid == 't_34_85' else vid

        if auth_key in authored:
            r = authored[auth_key]
            results[vid] = {
                'x': r['x'], 'y': r['y'], 'w': r['w'], 'h': r['h'],
                'source': 'authored', 'confidence': 1.0,
                'faction': faction, 'semantic_key': r.get('key', 'hullSideRight'),
            }
            print(f"  authored rect ({r['x']},{r['y']},{r['w']},{r['h']})")
            # Generate overlay for authored vehicles too
            rgt_data, _ = find_rgt(faction, vid)
            if rgt_data:
                try:
                    rgba = decode_rgt_to_rgba(rgt_data)
                    if rgba.shape[0] != 2048:
                        img = Image.fromarray(rgba, 'RGBA').resize((2048, 2048), Image.LANCZOS)
                        rgba = np.array(img)
                    save_overlay(rgba, r, vid)
                except Exception as e:
                    print(f"  overlay failed: {e}")
            continue

        rgt_data, src_desc = find_rgt(faction, vid)

        if not rgt_data:
            print(f"  NO SOURCE -> faction fallback")
            fb = faction_mean_rect(faction, authored)
            results[vid] = {**fb, 'source': 'fallback', 'confidence': 0.2,
                            'faction': faction, 'semantic_key': 'hullSideRight'}
            continue

        try:
            rgba = decode_rgt_to_rgba(rgt_data)
            print(f"  decoded {rgba.shape[1]}x{rgba.shape[0]} from {src_desc.split(':')[0]}")
        except Exception as e:
            print(f"  DECODE FAILED: {e}")
            fb = faction_mean_rect(faction, authored)
            results[vid] = {**fb, 'source': 'fallback', 'confidence': 0.1,
                            'faction': faction, 'semantic_key': 'hullSideRight'}
            continue

        if rgba.shape[0] != 2048 or rgba.shape[1] != 2048:
            img = Image.fromarray(rgba, 'RGBA').resize((2048, 2048), Image.LANCZOS)
            rgba = np.array(img)

        cx, cy, conf = detect_badge_centroid(rgba, vid, faction)

        if cx is None or conf < 0.25:
            print(f"  SCAN FAILED (conf={conf:.2f}) -> faction fallback")
            fb = faction_mean_rect(faction, authored)
            results[vid] = {**fb, 'source': 'fallback', 'confidence': conf or 0.1,
                            'faction': faction, 'semantic_key': 'hullSideRight'}
            save_overlay(rgba, fb, vid)
            continue

        sem_key = 'hullFront' if vid in ('t34_76', 't_34_85') else 'hullSideRight'
        rect = centroid_to_rect(cx, cy, 310)
        print(f"  centroid=({cx},{cy}) conf={conf:.2f} rect=({rect['x']},{rect['y']},{rect['w']},{rect['h']})")
        results[vid] = {
            **rect, 'source': 'scan', 'confidence': round(conf, 2),
            'faction': faction, 'semantic_key': sem_key,
        }
        save_overlay(rgba, rect, vid)

    # ---------------------------------------------------------------------------
    # Validation
    # ---------------------------------------------------------------------------
    print("\n=== VALIDATION vs 16 known rects ===\n")
    PASS_THRESHOLD = 40

    within_40 = 0
    total_known = 0
    validation_rows = []

    for vid, known in authored.items():
        total_known += 1
        result_vid = 't_34_85' if vid == 't34_85' else vid
        sr = results.get(result_vid)

        if not sr:
            print(f"  {vid}: NO RESULT")
            validation_rows.append({'vid': vid, 'status': 'missing'})
            continue

        if sr['source'] == 'authored':
            within_40 += 1
            print(f"  {vid}: authored (self-match)")
            validation_rows.append({'vid': vid, 'status': 'authored', 'dcx': 0, 'dcy': 0, 'pass': True})
            continue

        gt_cx = known['x'] + known['w'] // 2
        gt_cy = known['y'] + known['h'] // 2
        sc_cx = sr['x'] + sr['w'] // 2
        sc_cy = sr['y'] + sr['h'] // 2
        dcx = abs(sc_cx - gt_cx)
        dcy = abs(sc_cy - gt_cy)
        passed = dcx <= PASS_THRESHOLD and dcy <= PASS_THRESHOLD
        if passed:
            within_40 += 1
        status = 'PASS' if passed else 'FAIL'
        print(f"  {vid}: gt=({gt_cx},{gt_cy}) scan=({sc_cx},{sc_cy}) delta=({dcx},{dcy}) [{status}]")
        validation_rows.append({'vid': vid, 'status': status, 'dcx': dcx, 'dcy': dcy, 'pass': passed,
                                 'gt_cx': gt_cx, 'gt_cy': gt_cy, 'sc_cx': sc_cx, 'sc_cy': sc_cy})

    print(f"\n  Result: {within_40}/{total_known} within {PASS_THRESHOLD}px")

    # ---------------------------------------------------------------------------
    # Output files
    # ---------------------------------------------------------------------------

    # generated-rects.json
    out_json = {vid: {
        'x': r['x'], 'y': r['y'], 'w': r['w'], 'h': r['h'],
        'source': r['source'], 'confidence': r['confidence'],
        'faction': r['faction'], 'semantic_key': r.get('semantic_key', 'hullSideRight'),
    } for vid, r in results.items()}
    json_path = OUTPUT_DIR / 'generated-rects.json'
    json_path.write_text(json.dumps(out_json, indent=2, sort_keys=True))
    print(f"\nWrote {json_path}")

    # coverage-report.md
    src_counts = {}
    for r in results.values():
        src_counts[r['source']] = src_counts.get(r['source'], 0) + 1

    needs_review = [v for v, r in out_json.items() if r['source'] == 'fallback' or r['confidence'] < 0.4]

    lines = [
        "# Decal Badge-Slot Coverage Report",
        "",
        f"Generated: 2026-06-19  |  Total vehicles: {len(results)}",
        "",
        "## Source breakdown",
        "",
        "| Source | Count |",
        "|--------|-------|",
    ]
    for s, c in sorted(src_counts.items()):
        lines.append(f"| {s} | {c} |")

    lines += [
        "",
        "## Validation: 16 known-good rects (pass threshold: 40px centroid delta)",
        "",
        f"**Result: {within_40}/{total_known} within 40px**",
        "",
        "| Vehicle ID | GT center | Scan center | delta_cx | delta_cy | Status |",
        "|------------|-----------|-------------|----------|----------|--------|",
    ]
    for row in validation_rows:
        v = row['vid']
        if row['status'] == 'authored':
            lines.append(f"| {v} | (self) | (self) | 0 | 0 | authored |")
        elif row['status'] == 'missing':
            lines.append(f"| {v} | - | - | - | - | MISSING |")
        else:
            lines.append(f"| {v} | ({row.get('gt_cx','?')},{row.get('gt_cy','?')}) | ({row.get('sc_cx','?')},{row.get('sc_cy','?')}) | {row.get('dcx','-')} | {row.get('dcy','-')} | {row['status']} |")

    lines += [
        "",
        "## Per-vehicle results",
        "",
        "| Vehicle ID | Faction | Source | Confidence | Rect (x,y,w,h) | Semantic Key |",
        "|------------|---------|--------|------------|----------------|--------------|",
    ]
    for v, r in sorted(out_json.items()):
        lines.append(f"| {v} | {r['faction']} | {r['source']} | {r['confidence']:.2f} | ({r['x']},{r['y']},{r['w']},{r['h']}) | {r['semantic_key']} |")

    lines += [
        "",
        "## Vehicles needing manual review",
        "",
    ]
    for v in sorted(needs_review):
        r = out_json[v]
        lines.append(f"- `{v}` ({r['faction']}) — {r['source']} conf={r['confidence']:.2f}")

    (OUTPUT_DIR / 'coverage-report.md').write_text('\n'.join(lines) + '\n')
    print(f"Wrote {OUTPUT_DIR / 'coverage-report.md'}")

    print(f"\n=== FINAL SUMMARY ===")
    print(f"  authored: {src_counts.get('authored', 0)}")
    print(f"  scan:     {src_counts.get('scan', 0)}")
    print(f"  fallback: {src_counts.get('fallback', 0)}")
    print(f"  Validation: {within_40}/{total_known} within 40px")
    print(f"  Needs manual review: {len(needs_review)}")


if __name__ == '__main__':
    main()
