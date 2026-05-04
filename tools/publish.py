#!/usr/bin/env python3
"""
publish.py — upload a CoH2 skin pack SGA to Steam Workshop and install the
signed copy into the game's mods/skins folder.

Usage:
  python3 tools/publish.py <skin.sga> [options]

Options:
  --title     "My Skin Pack"   (default: SGA filename without extension)
  --desc      "Description"    (default: empty)
  --username  steamuser        (steamcmd login; prompted if omitted)
  --item-id   12345678         (existing workshop ID to update; omit for new)
  --visibility 0|1|2           (0=public, 1=friends, 2=private; default 2)
  --steam-root /path/to/steam  (auto-detected if omitted)
  --dry-run                    (build work dir, print VDF, don't call steamcmd)

What this script does:
  1. Creates a temp work directory with the SGA at mods/skins/<title>.sga
     and a minimal 200×200 preview PNG.
  2. Writes a workshop_manifest.vdf for steamcmd.
  3. Calls steamcmd to upload the item (new or update).
  4. Prints the published_file_id and opens the Steam store page so you can
     subscribe (the signed copy will land in CoH2's ugc/referenced/ folder
     after subscription + CoH2 launch).
  5. Watches ugc/referenced/<id>/mods/skins/ and prints a cp command once
     the signed SGA appears there.

Note on signatures:
  CoH2's engine requires a Relic RSA signature in every skin SGA loaded from
  mods/skins/. The signing happens either via CoH2 Mod Tools (if installed)
  or by Relic's CDN backend when the workshop item is processed. Until the
  signed copy is downloaded via Steam, the raw uploaded SGA will not load
  in-game.
"""

import argparse
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import textwrap
import urllib.request
import zlib
from pathlib import Path


# ---------------------------------------------------------------------------
# Tiny PNG encoder (no Pillow dependency)
# ---------------------------------------------------------------------------

def _make_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Return a minimal solid-colour PNG."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    header = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    raw_rows = b""
    row = bytes([0] + list(rgb) * width)
    for _ in range(height):
        raw_rows += row
    idat = chunk(b"IDAT", zlib.compress(raw_rows))
    iend = chunk(b"IEND", b"")
    return b"\x89PNG\r\n\x1a\n" + header + idat + iend


# ---------------------------------------------------------------------------
# Steam / steamcmd discovery
# ---------------------------------------------------------------------------

STEAMCMD_CANDIDATES = [
    "steamcmd",                       # on $PATH
    "steamcmd.sh",
    "/usr/bin/steamcmd",
    "/usr/games/steamcmd",
    str(Path.home() / ".steam/steamcmd/steamcmd.sh"),
    str(Path.home() / "steamcmd/steamcmd.sh"),
    str(Path.home() / ".local/share/Steam/steamcmd/steamcmd.sh"),
    # Flatpak Steam ships steamcmd inside its own prefix:
    "/var/lib/flatpak/app/com.valvesoftware.Steam/current/active/"
    "files/extra/steamcmd/steamcmd.sh",
]

STEAM_ROOT_CANDIDATES = [
    str(Path.home() / ".local/share/Steam"),
    str(Path.home() / ".steam/steam"),
    str(Path.home() / ".steam"),
    "/var/lib/flatpak/app/com.valvesoftware.Steam/current/active/files/extra",
]


def find_steamcmd() -> str | None:
    for c in STEAMCMD_CANDIDATES:
        if shutil.which(c) or Path(c).is_file():
            return c
    return None


def find_steam_root(hint: str | None = None) -> Path | None:
    if hint:
        p = Path(hint)
        return p if p.is_dir() else None
    for c in STEAM_ROOT_CANDIDATES:
        p = Path(c)
        if p.is_dir():
            return p
    return None


def find_ugc_dir(steam_root: Path, published_file_id: str) -> Path | None:
    """Return the ugc/referenced/<id> directory if it exists under any
    userdata/<steamid>/ subtree."""
    for userdata in (steam_root / "userdata").iterdir():
        if not userdata.is_dir():
            continue
        candidate = userdata / "ugc" / "referenced" / published_file_id
        if candidate.is_dir():
            return candidate
    return None


# ---------------------------------------------------------------------------
# steamcmd invocation
# ---------------------------------------------------------------------------

VDF_TEMPLATE = textwrap.dedent("""\
    "workshopitem"
    {{
        "appid"             "228980"
        "publishedfileid"   "{item_id}"
        "contentfolder"     "{content_folder}"
        "previewfile"       "{preview_file}"
        "visibility"        "{visibility}"
        "title"             "{title}"
        "description"       "{description}"
        "changenote"        "{changenote}"
        "tags"              "Skins"
    }}
""")


def build_work_dir(tmp: Path, sga_path: Path, title: str) -> tuple[Path, Path]:
    """Populate work dir and return (content_folder, preview_path)."""
    content = tmp / "content" / "mods" / "skins"
    content.mkdir(parents=True)
    dest_sga = content / (re.sub(r'[^\w\s\-.]', '_', title)[:60] + ".sga")
    shutil.copy2(sga_path, dest_sga)
    preview = tmp / "preview.png"
    preview.write_bytes(_make_png(200, 200, (30, 80, 30)))
    return tmp / "content", preview


def run_steamcmd(steamcmd: str, vdf_path: Path, username: str) -> str | None:
    """Run steamcmd and return the published_file_id string, or None on error."""
    cmd = [
        steamcmd,
        "+login", username,
        "+workshop_build_item", str(vdf_path),
        "+quit",
    ]
    print(f"\n▶  {' '.join(cmd)}\n")
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    output_lines: list[str] = []
    published_id: str | None = None
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
        output_lines.append(line)
        m = re.search(r"(?:published file id|Published file id)[^\d]*(\d+)", line, re.I)
        if m:
            published_id = m.group(1)
    proc.wait()
    if proc.returncode != 0:
        print(f"\n✗ steamcmd exited {proc.returncode}", file=sys.stderr)
        return None
    return published_id


# ---------------------------------------------------------------------------
# Watch for the signed SGA
# ---------------------------------------------------------------------------

def wait_for_signed_sga(steam_root: Path, published_id: str,
                         timeout: int = 300) -> Path | None:
    """Poll ugc/referenced/<id>/mods/skins/ until an .sga appears."""
    deadline = time.time() + timeout
    print(f"\nWaiting up to {timeout}s for CoH2 to download the signed SGA …")
    print("(Subscribe to the workshop item in Steam, then launch CoH2 once.)")
    while time.time() < deadline:
        ugc = find_ugc_dir(steam_root, published_id)
        if ugc:
            skins = ugc / "mods" / "skins"
            if skins.is_dir():
                sgas = list(skins.glob("*.sga"))
                if sgas:
                    return sgas[0]
        time.sleep(5)
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sga", help="Path to the unsigned .sga file")
    ap.add_argument("--title",      default="",  help="Workshop item title")
    ap.add_argument("--desc",       default="Created with CoH2 Skin Editor")
    ap.add_argument("--username",   default="",  help="Steam username for steamcmd login")
    ap.add_argument("--item-id",    default="0", help="Existing workshop ID to update (0 = new)")
    ap.add_argument("--visibility", default="2", choices=["0","1","2"],
                    help="0=public 1=friends 2=private (default 2)")
    ap.add_argument("--steam-root", default="",  help="Path to Steam installation root")
    ap.add_argument("--no-wait",    action="store_true",
                    help="Skip the signed-SGA watcher after upload")
    ap.add_argument("--dry-run",    action="store_true",
                    help="Prepare work dir and print VDF without calling steamcmd")
    args = ap.parse_args()

    sga_path = Path(args.sga).expanduser().resolve()
    if not sga_path.is_file():
        print(f"✗ SGA not found: {sga_path}", file=sys.stderr)
        return 1

    title = args.title or sga_path.stem
    username = args.username or input("Steam username: ").strip()
    if not username:
        print("✗ Steam username required", file=sys.stderr)
        return 1

    steamcmd_bin = find_steamcmd()
    if not steamcmd_bin and not args.dry_run:
        print(
            "✗ steamcmd not found. Install it:\n"
            "  Fedora/RHEL:  sudo dnf install steamcmd\n"
            "  Debian/Ubuntu: sudo apt install steamcmd\n"
            "  Or download from https://developer.valvesoftware.com/wiki/SteamCMD",
            file=sys.stderr,
        )
        return 1

    steam_root = find_steam_root(args.steam_root or None)
    if not steam_root:
        print("⚠  Could not auto-detect Steam root; --steam-root required for SGA watcher")

    with tempfile.TemporaryDirectory(prefix="coh2-publish-") as tmp_str:
        tmp = Path(tmp_str)
        content_folder, preview_file = build_work_dir(tmp, sga_path, title)

        vdf_text = VDF_TEMPLATE.format(
            item_id=args.item_id,
            content_folder=str(content_folder),
            preview_file=str(preview_file),
            visibility=args.visibility,
            title=title.replace('"', '\\"'),
            description=args.desc.replace('"', '\\"'),
            changenote="Uploaded via CoH2 Skin Editor publish script",
        )
        vdf_path = tmp / "workshop_manifest.vdf"
        vdf_path.write_text(vdf_text)

        print("── workshop_manifest.vdf ──────────────────────────────────")
        print(vdf_text)
        print("────────────────────────────────────────────────────────────")

        if args.dry_run:
            print("Dry-run: stopping here. Work dir:", tmp_str)
            input("Press Enter to delete work dir and exit …")
            return 0

        published_id = run_steamcmd(str(steamcmd_bin), vdf_path, username)
        if not published_id:
            print("\n✗ Could not determine published_file_id from steamcmd output.",
                  file=sys.stderr)
            return 1

        print(f"\n✓ Published file id: {published_id}")
        store_url = f"https://steamcommunity.com/sharedfiles/filedetails/?id={published_id}"
        steam_url = f"steam://openurl/{store_url}"
        print(f"  Store page: {store_url}")
        print(f"\n→ Opening Subscribe page in Steam …")
        # Open in Steam client so the user can click Subscribe
        try:
            subprocess.Popen(["xdg-open", steam_url])
        except Exception:
            print(f"  (Could not auto-open; visit manually: {store_url})")

        print(
            "\nAfter subscribing:\n"
            "  1. Launch CoH2 once — it will download the signed SGA.\n"
            "  2. The script will detect the download and print the install path.\n"
        )

        if args.no_wait or not steam_root:
            print("Skipping watcher (--no-wait or Steam root unknown).")
            print(f"Look for the SGA under: <steam_root>/userdata/<your_id>/ugc/referenced/{published_id}/mods/skins/")
            return 0

        signed = wait_for_signed_sga(steam_root, published_id)
        if signed:
            print(f"\n✓ Signed SGA found: {signed}")
            print(
                "\nThe signed copy is already in CoH2's ugc folder — the game will\n"
                "load it automatically from there. If you also want it in mods/skins/\n"
                "for a different profile, copy it:\n"
                f"  cp '{signed}' '<docs>/My Games/Company of Heroes 2/mods/skins/{published_id}.sga'"
            )
        else:
            print(
                f"\n⚠  Timed out waiting. Check manually:\n"
                f"  <steam_root>/userdata/<your_id>/ugc/referenced/{published_id}/mods/skins/"
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
