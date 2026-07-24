/**
 * scripts/build-verify-gamemode.mts
 *
 * Builds and packs the CoH2 "ASAP Verify" win-condition gamemode SGA using the
 * repo's own pure-Node buildSga() writer (src/lib/sga-writer.ts) — no ModBuilder,
 * no wine. Everything in the mod (.win, .scar, .info) is plain UTF-8 text; the
 * only binary is a tiny preview.tga thumbnail we synthesize here.
 *
 * Follows artifacts/ingame-verify/scar-gamemode-design.md EXACTLY:
 *   - Mod file layout (§1): game/winconditions/*.win + scar/winconditions/*.scar
 *     + <MODGUID>.info + preview.tga, packed by buildSga (backslash DFS paths,
 *     zlib storage — all handled internally by the writer).
 *   - .win schema (§1a) and .info schema (§1b) verbatim.
 *   - SCAR behavior (§2) with R1/R2 resolved (see comments in SCAR_TEXT).
 *
 * Open risks resolved (verified against on-disk ground truth this session):
 *   R1 (SBP names): re-grepped AttribArchive.sga.
 *       - Panther: `panther_squad_mp`  (VERIFIED present:
 *         attrib/sbps/races/german/vehicles/panther_squad/panther_squad_mp.rgd)
 *       - Puma: `puma_squad_mp` does NOT exist. The only Puma _mp stem is
 *         `puma_east_german_mp`
 *         (attrib/sbps/races/german/vehicles/puma/puma_east_german_mp.rgd) — used.
 *       Every blueprint is null-guarded in the SCAR (bad name => skip cell, never crash).
 *   R2 (spawn origin): spawn relative to Player 1's start via
 *       `Player_GetStartingPosition(player)` — VERIFIED used in base
 *       scar/fatalities/fatalities.scar:31 — instead of world (0,0).
 *
 * Run: npx tsx --tsconfig tsconfig.node.json scripts/build-verify-gamemode.mts
 */
import { writeFile, mkdir, readFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const { buildSga } = (await import(`${ROOT}/src/lib/sga-writer.ts`)) as {
  buildSga: (opts: {
    archiveName: string
    files: {
      path: string
      bytes: Uint8Array
      compress?: boolean
      storage?: 'stream' | 'buffer' | 'raw'
      verification?: 'none' | 'crc_blocks' | 'sha1_blocks' | number
    }[]
    driveLayout?: 'skin' | 'gamemode'
  }) => Promise<Uint8Array>
}
const { SgaArchive } = await import(`${ROOT}/src/lib/sga.ts`)

const enc = (s: string) => new TextEncoder().encode(s)

// GEN6 (2026-07-19) — LINE-ENDING FIX (root cause of "loads but not listed").
// Every working listed gamemode mod's text payloads (.win/.info/.scar) use CRLF
// (\r\n); ours (Gen1–Gen5) emitted bare LF. CoH2's win-condition .win parser is
// line-oriented and tokenises on \r\n: an LF-only .win mounts cleanly (archive
// [Sig:0]) but is dropped from the selectable Win-Condition dropdown when a
// record/field terminator never matches. Byte-verified across all 5 working mods
// (mods/gamemode/subscriptions/{333857863,353675196,481822725,606599092,
// 1660217730}): every .win/.info/.scar contains \r (0x0D) > 0. CRLF-normalise all
// text payloads before encoding so the packed bytes carry 0x0D like the working mods.
const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n')

// ---------------------------------------------------------------------------
// MOD identity — a 32-hex GUID, reused as archiveName + .info stem (per §1/§4).
// Stable so re-runs overwrite the same installed file (idempotent install).
// ---------------------------------------------------------------------------
const MODGUID = 'a5a90ec1f00f4b7e9c0d3a2b1e4f5a60'
const WIN_STEM = 'asap_verify'
const FE_NAME = 'ASAP Verify'

// ---------------------------------------------------------------------------
// §1a — game/winconditions/asap_verify.win  (PLAIN TEXT). fe_name is the exact
// dropdown label in the skirmish lobby's game-mode dropdown.
//
// GEN5 (2026-07-19) — the LOBBY-LISTING content fix. Gen4 fixed the SGA drive
// layout (2-drive data-first) so the mod BOOTS clean [Sig:0] with no MOD errors,
// but it was STILL absent from the Win-Condition dropdown. Byte-level decode of
// the .win RGD CONTENT of ALL 5 working subscribed gamemode mods (70 .win files
// total: 333857863 / 353675196 / 481822725 / 606599092 / 1660217730) proved:
//   - The .win is PLAIN UTF-8 text (NOT a Relic Chunky/RGD blob) — our decode
//     matches theirs field-for-field; fe_name is a LITERAL ASCII string in every
//     working mod (NO $UCS locale-key indirection). So our literal `fe_name =
//     "ASAP Verify"` was already correct — the display-name path was NOT broken.
//   - The DECISIVE difference: EVERY ONE of the 70 working .win files carries an
//     `entity_replacements = { ... }` block, a `requires_vp_ticker` field, or
//     BOTH. ZERO working .win has neither. OURS (Gen4) had NEITHER — it stopped
//     at `show_time`. All 5 entries confirmed present in the in-game dropdown
//     capture have `entity_replacements` (and no `requires_vp_ticker`). The
//     engine's win-condition menu scanner requires the mode-metadata block to be
//     "complete" — a .win that ends at show_time with no entity_replacements /
//     requires_vp_ticker is parsed + loaded but dropped from the selectable list.
//
// FIX: append the `entity_replacements` block exactly as the confirmed-LISTED
// Resources modes encode it (`original="victory_point"` → `replacement=
// "territory_point_mp"`). This is inert for our capture SCAR (we don't touch
// victory points) but makes the mode-metadata "complete" so the lobby scanner
// lists it. fe_name stays the literal "ASAP Verify". No .ucs is needed (working
// mods bundle none; all names are literal). Boot-safe invariants unchanged:
// 2-drive data-first, .win storage=1, verif=0 everywhere.
// ---------------------------------------------------------------------------
const WIN_TEXT = `name = "${WIN_STEM}"
scar_file = "data:scar/winconditions/${WIN_STEM}.scar"
fe_name = "${FE_NAME}"
fe_priority = 0
score_display = time
show_time = true
entity_replacements =
{
	{
		original = "victory_point",
		replacement = "territory_point_mp",
	}
}
`

// ---------------------------------------------------------------------------
// §1b — <MODGUID>.info  (PLAIN TEXT metadata)
// ---------------------------------------------------------------------------
const INFO_TEXT = `hidden = false
name = "ASAP Verify Gamemode"
description = "Auto-spawns a grid of German vehicles, reveals FOW, and frames the camera for skin/decal capture."
dependencies =
{
}
`

// ---------------------------------------------------------------------------
// §2 — scar/winconditions/asap_verify.scar  (the win-condition script)
//
// Behavior (per task + §2):
//   init (Scar_AddInit) -> resources/pop-cap -> FOW_RevealAll -> spawn the
//   German vehicle grid for player 1 (~10 vehicles, 15 m spacing) relative to
//   Player 1's start (R2) -> frame the camera on the grid -> draw the OCR marker.
//   PLUS: after the initial wide grid hold (~10 s), slowly step the camera up
//   close to each vehicle in sequence (~6 s per vehicle, Camera_MoveTo) so the
//   harness gets input-free close-ups, then loop back to the wide shot.
//
// Every risky call is wrapped in pcall / null-guarded so a partial failure
// still leaves the grid + camera usable.
// ---------------------------------------------------------------------------
const SCAR_TEXT = `-- ============================================================================
-- ASAP Verify -- in-game skin/decal verification gamemode  (GEN12)
-- Spawns a grid of player-1 German vehicles, reveals FOW, frames + cycles the
-- camera so an external harness can screenshot the equipped skin/decal on every
-- vehicle class with zero input.
--
-- GEN10 (2026-07-20): the mixed grid/hero cluster made it impossible to isolate
-- the German national insignia (balkenkreuz, baked on the hull SIDE) in one clean
-- screenshot. Gen10 spawns ONE dedicated "photo hero" tank in its own SGroup
-- (sg_photo), well AWAY from the grid (origin +40 on world X), turns it side-on,
-- and points the Gen9 camera pin at sg_photo ONLY -- low + close + near-horizontal
-- so the isolated tank fills the frame and its hull-side insignia reads cleanly.
--
-- GEN12 (2026-07-24): the Gen11 single photo hero landed at origin +40/+40, right
-- next to an oil derrick / map edge among trees -- unframeable. Gen12 spawns THREE
-- photo heroes on the PROVEN-OPEN ground near the grid: offsets from asap.origin of
-- (+14,-10), (+14,0), (+14,+10) via Util_ScarPos. Each gets a DIFFERENT facing
-- (Squad_FacePosition toward world +X / +Z / -X respectively) so at least one hull
-- side squares to CoH2's fixed camera. The close low-side camera
-- Camera_SetDefault(14, 22, TV_DefaultAngle) is retargeted at the MIDDLE hero.
--
-- Risks resolved:
--   R1 (SBP names): verified against AttribArchive.sga this session.
--     panther_squad_mp (verified). Puma uses puma_east_german_mp (the ONLY Puma
--     _mp stem; puma_squad_mp does not exist). Every BP is null-guarded below.
--   R2 (spawn origin): grid is anchored to Player_GetStartingPosition(player)
--     (verified in base scar/fatalities/fatalities.scar) rather than world (0,0).
--   R3/GEN6 (match must START): import the base annihilate win-condition so the
--     started match has a real, valid victory condition and initialises. Exact
--     import form verified against working mods' .scar (333857863/353675196/...:
--     first line is import("winconditions/annihilate.scar")). Its Scar_AddInit
--     coexists with ours; our ASAP_VERIFY spawn/camera logic runs after it.
-- ============================================================================
import("winconditions/annihilate.scar")


-- Grid config -----------------------------------------------------------------
local GRID_SPACING = 15          -- metres between vehicles (CoH2 world units ~= metres)
local GRID_COLS    = 5           -- 5 x 2 = 10 cells

-- Hero insignia close-up config -----------------------------------------------
-- GEN8 (2026-07-20) -- dedicated side-on balkenkreuz photo target. CoH2's camera
-- is FIXED pitch/yaw (pan+zoom only, no orbit): a vehicle's hull SIDE (where the
-- national insignia / schuerzen decal is baked, per TEXCOORD1) only faces the
-- camera when the vehicle is turned ~90 deg off the camera's look axis. We spawn
-- ONE clean-hulled medium/heavy tank well clear of the grid, turn it side-on, and
-- park the camera low + close on it with a long stable hold (no cycling).
--
-- HEADING API (verified ground truth, Data.sga scar/groups.scar:2024,2054):
--   SGroup_FacePosition(sgroup, worldPos)  -> group turns to face worldPos.
--   Also Util_CreateSquads(...) 11th arg spawn_facing (a pos) sets spawn heading
--   via Squad_CreateAndSpawnToward(bp,player,loadout,pos,toward) (scarutil.scar:763).
-- CAMERA API (verified, scar/camera.scar:134): Camera_SetDefault(height,declination,
--   angle) -> TV_DefaultHeight/TV_DefaultDeclination/TV_DefaultAngle. (There is NO
--   TV_DistMax/TV_Pitch in the stdlib -- only those three TV_Default* exist; the
--   grid's TV_DistMax lines are undefined-global no-ops, harmless under safe().)
--
-- BELT-AND-BRACES: the exact sign of the camera's yaw axis vs world +X/+Z is not
-- 100% certain across maps, so we spawn THREE hero copies in a row, each facing a
-- DIFFERENT direction (world +X, world -X, and toward the camera), guaranteeing at
-- least one presents its insignia-bearing hull side squarely to the fixed camera.
local HERO_SBP_CANDIDATES = {
   "panther_squad_mp",    -- Panther: long flat side skirts = clean insignia [verified]
   "panzer_iv_squad_mp",  -- Panzer IV: flat schuerzen side [verified] (fallback)
   "tiger_squad_mp",      -- Tiger I: broad flat hull side [verified] (fallback)
}
local HERO_OFFSET_X   = 40   -- metres RIGHT of the grid origin (well clear of the grid)
local HERO_OFFSET_Z   = -25  -- metres toward camera-home from origin (in front of grid)
local HERO_SPACING    = 14   -- metres between the 3 hero copies (row along world X)
local HERO_CAM_HEIGHT = 14   -- low camera for a near side-on hull framing
local HERO_CAM_DECLIN = 42   -- steeper-than-default downward pitch to fill the frame
local HERO_HOLD_DELAY = 3    -- seconds after setup before the camera locks on the hero

-- GEN12 TRIPLE "photo hero" config --------------------------------------------
-- THREE clean-hulled German medium/heavy tanks in ONE SGroup (sg_photo), on the
-- PROVEN-OPEN ground near the grid (Gen11's single +40/+40 hero landed by an oil
-- derrick / map edge among trees -- unframeable). Each hero gets a DIFFERENT facing
-- so at least one hull SIDE (where the balkenkreuz is baked, per TEXCOORD1) squares
-- to CoH2's fixed camera. Reuses HERO_SBP_CANDIDATES (real, verified blueprints).
-- Three cells at asap.origin + (PHOTO_OFFSET_X, Z) for Z in PHOTO_OFFSETS_Z:
local PHOTO_OFFSET_X   = 14           -- metres +X of the grid origin (open ground near the grid)
local PHOTO_OFFSETS_Z  = { -10, 0, 10 } -- three cells along world Z: hero 1 / 2(middle) / 3
local PHOTO_CAM_HEIGHT = 14           -- GEN10/12: low so the middle tank fills the frame
local PHOTO_CAM_DECLIN = 22           -- GEN10/12: near-horizontal -> look at the SIDE, not the top

-- SBP leaf names -- EXACT, from AttribArchive.sga (attrib/sbps/races/german/vehicles/**).
-- BP_GetSquadBlueprint() takes the leaf name (no path, no .rgd). Use _mp variants
-- (skirmish/multiplayer balance blueprints) so they exist in a skirmish context.
local VEHICLE_SBP_NAMES = {
   "tiger_squad_mp",               -- Tiger I            (heavy)      [verified]
   "panther_squad_mp",             -- Panther            (med/heavy)  [verified R1]
   "panzer_iv_squad_mp",           -- Panzer IV          (medium)     [verified]
   "stug_iii_squad_mp",            -- StuG III           (TD)         [verified]
   "brummbar_squad_mp",            -- Brummbaer          (assault gun)[verified]
   "ostwind_squad_mp",             -- Ostwind            (AA/medium)  [verified]
   "panzerwerfer_squad_mp",        -- Panzerwerfer       (rocket HT)  [verified]
   "sdkfz_251_halftrack_squad_mp", -- Sd.Kfz.251 HT      (light)      [verified]
   "scoutcar_sdkfz222_mp",         -- Sd.Kfz.222 scout   (light)      [verified]
   "puma_east_german_mp",          -- Puma (SdKfz 234)   (light)      [verified R1]
}

-- Runtime state ---------------------------------------------------------------
local asap = {
   player      = nil,   -- Player 1
   origin      = nil,   -- ScarPosition: grid origin (near player-1 start)
   center      = nil,   -- ScarPosition: grid centre (wide-shot target)
   cellPos     = {},    -- ScarPosition per spawned cell (for close-up cycle)
   spawnedRows = 1,     -- number of grid rows actually used
   cycleIndex  = 0,     -- 0 = wide shot, 1..N = close-up on cell N
   heroSg      = nil,   -- SGroup HANDLE of the spawned hero row (source of truth)
   heroPos     = nil,   -- ScarPosition: LAST resolved hero world pos (for debug)
   heroCount   = 0,     -- how many hero blueprints actually spawned (0..3)
   heroReady   = false, -- true once at least one hero vehicle actually spawned
   pinTicks    = 0,     -- GEN9: how many times the persistence pin has fired
   photoSg     = nil,   -- GEN10: SGroup HANDLE of the isolated side-on photo hero
   photoPos    = nil,   -- GEN10: ScarPosition: LAST resolved photo-hero world pos
   photoReady  = false, -- GEN10: true once the isolated photo hero actually spawned
}

-- Safe-call wrapper: never let one failed engine call abort the whole setup.
-- (Declared FIRST so the debug/pos helpers below capture the local as an upvalue.)
local function safe(fn)
   local ok, err = pcall(fn)
   if not ok then
      -- Print to the SCAR console/log; harmless if the print target is absent.
      if print ~= nil then pcall(function() print("ASAP_VERIFY: " .. tostring(err)) end) end
   end
   return ok
end

-- GEN9: on-screen debug line so the harness can SEE hero pos + camera target from
-- a screenshot even if framing is off. dr_text2d RGB is 0..255 (NOT 0..1 -- the
-- Gen8 marker used 1,1,1 = near-black/invisible; PrintOnScreen uses 213,213,213,
-- verified printonscreen.scar:29). Layer "asap_dbg<slot>" persists (autoclear off).
local function asap_dbg(line, yslot)
   safe(function()
      dr_clear("asap_dbg" .. tostring(yslot))
      dr_setautoclear("asap_dbg" .. tostring(yslot), false)
      dr_text2d("asap_dbg" .. tostring(yslot), 0.02, 0.06 + yslot * 0.035,
                line, 255, 235, 40)   -- bright yellow, readable on any terrain
   end)
end

-- Read x,z out of a ScarPosition (or an SGroup/Squad) with full null-guarding.
local function asap_xz(v)
   local x, z = 0, 0
   pcall(function()
      local p = v
      if scartype ~= nil and scartype(v) ~= ST_SCARPOS then
         p = Util_GetPosition(v)   -- resolves SGroup/Squad -> world pos (scarutil.scar:2162)
      end
      if p ~= nil then x = p.x; z = p.z end
   end)
   return x, z
end

-- Build a world position offset from the grid origin by (col,row) cells.
local function asap_cell_pos(col, row)
   local ox, oz = 0, 0
   if asap.origin ~= nil then
      -- ScarPosition has .x/.z fields (World_Pos). Fall back to 0,0 if absent.
      local okx = pcall(function() ox = asap.origin.x end)
      local okz = pcall(function() oz = asap.origin.z end)
      if not okx then ox = 0 end
      if not okz then oz = 0 end
   end
   local x = ox + col * GRID_SPACING
   local z = oz + row * GRID_SPACING
   -- Util_ScarPos(x, z) -> World_Pos(x, y, z); y auto-resolves to terrain.
   return Util_ScarPos(x, z)
end

-- ---------------------------------------------------------------------------
function ASAPVerify_SpawnGrid()
   local player = asap.player
   local sgroup = SGroup_CreateIfNotFound("sg_asap_verify")   -- groups.scar
   local n = table.getn(VEHICLE_SBP_NAMES)
   asap.cellPos = {}
   for i = 1, n do
      local col = math.mod((i - 1), GRID_COLS)
      local row = math.floor((i - 1) / GRID_COLS)
      local pos = asap_cell_pos(col, row)
      asap.cellPos[i] = pos
      -- Null-guard the blueprint: a bad/unknown name skips this cell, never crashes.
      local bp = nil
      pcall(function() bp = BP_GetSquadBlueprint(VEHICLE_SBP_NAMES[i]) end)
      if bp ~= nil then
         -- Util_CreateSquads(player, sgroupName, sbp, location, dest, numSquads, loadout)
         -- Wrapped so a single bad spawn doesn't abort the rest of the grid.
         safe(function()
            Util_CreateSquads(player, "sg_asap_verify", bp, pos, nil, 1, 0)
         end)
      end
   end
   asap.spawnedRows = math.floor((n - 1) / GRID_COLS) + 1
end

-- ---------------------------------------------------------------------------
-- Spawn the HERO insignia close-up target(s). One clean-hulled medium/heavy
-- German tank turned side-on to the fixed camera so its balkenkreuz (baked on the
-- hull SIDE / schuerzen) faces the lens. Belt-and-braces: THREE copies in a row,
-- each facing a different direction, so at least one shows its insignia side to
-- CoH2's non-orbitable camera regardless of the map's yaw-axis sign.
function ASAPVerify_SpawnHero()
   -- Pick the first candidate blueprint that actually resolves (null-guarded).
   local heroBp = nil
   local nCand = table.getn(HERO_SBP_CANDIDATES)
   for i = 1, nCand do
      if heroBp == nil then
         pcall(function()
            local bp = BP_GetSquadBlueprint(HERO_SBP_CANDIDATES[i])
            if bp ~= nil then heroBp = bp end
         end)
      end
   end
   if heroBp == nil then return end   -- no hero BP resolved -> grid still usable

   -- Base position: offset from the grid origin, well clear of the grid rows.
   local ox, oz = 0, 0
   if asap.origin ~= nil then
      pcall(function() ox = asap.origin.x end)
      pcall(function() oz = asap.origin.z end)
   end
   local baseX = ox + HERO_OFFSET_X
   local baseZ = oz + HERO_OFFSET_Z

   -- GEN9: store the SGroup HANDLE so the camera can pin to the ACTUAL spawned
   -- squad's position (SGroup_GetPosition / Camera_Follow) instead of a computed
   -- ScarPos. This is the core Gen8 fix: the Gen8 camera targeted Util_ScarPos(hx,hz)
   -- (a guessed point that World_GetNearestInteractablePoint could resolve far from
   -- the tank), so it framed empty ground. Camera keyed off the real squad won't.
   local heroSg = SGroup_CreateIfNotFound("sg_asap_hero")
   asap.heroSg = heroSg

   -- Three hero copies along world +X, each with a DIFFERENT facing target so the
   -- three present distinct hull orientations to the camera (belt-and-braces).
   --   copy 1: faces world +X (far right)   -> side faces toward/away camera axis
   --   copy 2: faces world -X (far left)     -> opposite side to copy 1
   --   copy 3: faces the camera home (toward -Z) -> front/other side
   local spawned = 0
   for i = 1, 3 do
      local hx = baseX + (i - 1) * HERO_SPACING
      local hz = baseZ
      local pos = nil
      pcall(function() pos = Util_ScarPos(hx, hz) end)
      if pos ~= nil then
         -- spawn_facing target per copy (a far-off point in the chosen direction).
         local faceX, faceZ = hx, hz
         if i == 1 then faceX = hx + 100          -- face world +X
         elseif i == 2 then faceX = hx - 100      -- face world -X
         else faceZ = hz - 100 end                -- face toward camera home (-Z)
         local facePos = nil
         pcall(function() facePos = Util_ScarPos(faceX, faceZ) end)

         -- Spawn with the 11th arg spawn_facing (verified scarutil.scar:694/763).
         local okSpawn = safe(function()
            Util_CreateSquads(asap.player, "sg_asap_hero", heroBp, pos, nil, 1, 0,
                              nil, nil, nil, facePos)
         end)
         if okSpawn then spawned = spawned + 1 end
         -- Belt-and-braces re-face after spawn via the verified group-heading API.
         if facePos ~= nil then
            safe(function() SGroup_FacePosition(heroSg, facePos) end)
         end
      end
   end

   -- GEN9: how many actually spawned, from the LIVE sgroup (source of truth).
   asap.heroCount = 0
   pcall(function() asap.heroCount = SGroup_CountSpawned(heroSg) end)
   if asap.heroCount == 0 then asap.heroCount = spawned end   -- fallback estimate

   -- GEN9: resolve the camera target from the REAL spawned squad group, not a
   -- guessed ScarPos. SGroup_GetPosition returns the group's centroid world pos.
   if asap.heroCount and asap.heroCount > 0 then
      pcall(function() asap.heroPos = SGroup_GetPosition(heroSg) end)
   end
   -- Last-ditch fallback so debug/framing still has a target if the group query fails.
   if asap.heroPos == nil then
      pcall(function() asap.heroPos = Util_ScarPos(baseX + HERO_SPACING, baseZ) end)
   end
   asap.heroReady = (asap.heroPos ~= nil) and (asap.heroCount ~= nil) and (asap.heroCount > 0)

   -- GEN9 on-screen debug: how many heroes spawned + where.
   local hx, hz = asap_xz(asap.heroPos)
   asap_dbg("HERO SPAWNED n=" .. tostring(asap.heroCount)
            .. " x=" .. tostring(math.floor(hx)) .. " z=" .. tostring(math.floor(hz)), 0)
end

-- ---------------------------------------------------------------------------
-- GEN12: spawn THREE "photo heroes" -- clean-hulled German tanks on the PROVEN-OPEN
-- ground near the grid (asap.origin + (+14, {-10,0,+10})), all in ONE SGroup
-- (sg_photo). Each hero gets a DIFFERENT facing (Squad_FacePosition toward world +X,
-- +Z, -X respectively) so at least one hull SIDE -- where the balkenkreuz is baked
-- per TEXCOORD1 -- squares to CoH2's fixed camera. The Gen9 camera pin is retargeted
-- at the MIDDLE hero (asap.photoPos) so a screenshot captures the national insignia
-- with the three tanks close together in frame; the harness can also minimap-jump to
-- each. This replaces the Gen11 single +40/+40 hero that landed by an oil derrick.
function ASAPVerify_SpawnPhotoHero()
   -- Pick the first candidate blueprint that actually resolves (null-guarded).
   -- Reuses HERO_SBP_CANDIDATES (panther_squad_mp / panzer_iv_squad_mp / tiger_squad_mp).
   local photoBp = nil
   local nCand = table.getn(HERO_SBP_CANDIDATES)
   for i = 1, nCand do
      if photoBp == nil then
         pcall(function()
            local bp = BP_GetSquadBlueprint(HERO_SBP_CANDIDATES[i])
            if bp ~= nil then photoBp = bp end
         end)
      end
   end
   if photoBp == nil then return end   -- no BP resolved -> grid/hero still usable

   -- Base position: the grid origin plus the open-ground X offset. Uses the SAME
   -- position-construction idiom as the rest of the file (Util_ScarPos).
   local ox, oz = 0, 0
   if asap.origin ~= nil then
      pcall(function() ox = asap.origin.x end)
      pcall(function() oz = asap.origin.z end)
   end
   local px = ox + PHOTO_OFFSET_X

   -- Own SGroup so the camera can pin to THESE tanks only (source of truth).
   local photoSg = SGroup_CreateIfNotFound("sg_photo")
   asap.photoSg = photoSg

   -- Spawn THREE tanks into sg_photo, one per PHOTO_OFFSETS_Z cell, each with a
   -- DIFFERENT facing so at least one presents its insignia-bearing hull SIDE to the
   -- fixed camera regardless of the map's yaw-axis sign:
   --   hero 1 (z=-10): faces world +X    hero 2/middle (z=0): faces world +Z
   --   hero 3 (z=+10): faces world -X
   local midPos = nil
   for i = 1, 3 do
      local pz = oz + PHOTO_OFFSETS_Z[i]
      local pos = nil
      pcall(function() pos = Util_ScarPos(px, pz) end)
      if pos ~= nil then
         if i == 2 then midPos = pos end   -- MIDDLE hero = the camera target
         -- Spawn this hero into sg_photo (same Util_CreateSquads helper the grid uses).
         safe(function()
            Util_CreateSquads(asap.player, "sg_photo", photoBp, pos, nil, 1, 0)
         end)
         -- Per-hero facing target: a far-off point in the chosen compass direction.
         --   i==1 -> +X ; i==2 -> +Z ; i==3 -> -X
         local faceX, faceZ = px, pz
         if i == 1 then faceX = px + 100          -- hero 1 faces world +X
         elseif i == 2 then faceZ = pz + 100      -- hero 2 (middle) faces world +Z
         else faceX = px - 100 end                -- hero 3 faces world -X
         local facePos = nil
         pcall(function() facePos = Util_ScarPos(faceX, faceZ) end)
         -- Turn the just-spawned squad (last in the group) to its facing target.
         if facePos ~= nil then
            safe(function()
               Squad_FacePosition(SGroup_GetSpawnedSquadAt(asap.photoSg, i), facePos)
            end)
         end
      end
   end

   -- Camera target = the MIDDLE hero. Prefer its LIVE group-resolved position; fall
   -- back to the computed middle ScarPos so framing/debug always has a target.
   pcall(function() asap.photoPos = SGroup_GetPosition(photoSg) end)
   if asap.photoPos == nil then asap.photoPos = midPos end
   local pcount = 0
   pcall(function() pcount = SGroup_CountSpawned(photoSg) end)
   asap.photoReady = (asap.photoPos ~= nil) and (pcount > 0)

   -- GEN12 on-screen debug: prove the three photo heroes spawned + where (middle).
   local dx, dz = asap_xz(asap.photoPos)
   asap_dbg("PHOTO HERO n=" .. tostring(pcount)
            .. " x=" .. tostring(math.floor(dx)) .. " z=" .. tostring(math.floor(dz)), 2)
end

-- ---------------------------------------------------------------------------
-- GEN12: lock the camera LOW + CLOSE + SIDE-ON on the MIDDLE photo hero (squad #2 of
-- sg_photo) so a screenshot captures its hull-side balkenkreuz with the trio close
-- together in frame. Keeps the exact Gen9 pin pattern (SGroup_GetPosition ->
-- Camera_MoveTo/Camera_Follow), retargeted at the middle hero + near-horizontal default.
function ASAPVerify_FramePhotoHero()
   if not asap.photoReady then return end
   -- GEN10/12: close, low, near-horizontal default so we look at the tank's SIDE.
   safe(function() Camera_SetDefault(PHOTO_CAM_HEIGHT, PHOTO_CAM_DECLIN, TV_DefaultAngle) end)  -- tune to face insignia side
   safe(function() Camera_ResetToDefault() end)

   -- GEN12: re-read the MIDDLE hero's LIVE world pos (squad #2 in sg_photo) each time,
   -- so the camera centres on the middle of the three (not the group centroid/first).
   local pos = nil
   local midSquad = nil
   if asap.photoSg ~= nil then
      pcall(function() midSquad = SGroup_GetSpawnedSquadAt(asap.photoSg, 2) end)
      if midSquad ~= nil then
         pcall(function() pos = Squad_GetPosition(midSquad) end)
      end
      if pos == nil then
         pcall(function() pos = SGroup_GetPosition(asap.photoSg) end)   -- fallback: group centroid
      end
   end
   if pos == nil then pos = asap.photoPos end
   asap.photoPos = pos

   -- Move the camera onto the middle photo hero and hold it (keepLocked=true).
   safe(function() Camera_MoveTo(pos, false, nil, true) end)
   -- Follow the MIDDLE squad (squad #2) if resolvable; else follow the group.
   if midSquad ~= nil then
      safe(function() Camera_FollowSquad(midSquad) end)
   else
      safe(function() Camera_Follow(asap.photoSg) end)
   end

   -- GEN12 on-screen debug: prove where the camera was told to point.
   local cx, cz = asap_xz(pos)
   asap_dbg("CAM->PHOTO x=" .. tostring(math.floor(cx))
            .. " z=" .. tostring(math.floor(cz))
            .. " pin=" .. tostring(asap.pinTicks), 3)
end

-- ---------------------------------------------------------------------------
-- Lock the camera LOW + CLOSE on the hero row for a stable side-on insignia
-- frame. Uses the verified Camera_SetDefault(height, declination, angle) tuning
-- (scar/camera.scar:134) for a near, steeply-pitched shot, then Camera_MoveTo the
-- hero. No cycling -- this is the stable frame the harness photographs.
function ASAPVerify_FrameHero()
   if not asap.heroReady then return end
   -- Low, steep camera default so the hull SIDE fills much of the frame.
   safe(function() Camera_SetDefault(HERO_CAM_HEIGHT, HERO_CAM_DECLIN, nil) end)
   safe(function() Camera_ResetToDefault() end)

   -- GEN9 core fix: pin the camera to the ACTUAL spawned squad, resolved live from
   -- the SGroup handle, NOT a precomputed ScarPos.
   --   (a) Re-read the real world pos of the hero row each time we frame.
   local pos = nil
   if asap.heroSg ~= nil then
      pcall(function() pos = SGroup_GetPosition(asap.heroSg) end)
   end
   if pos == nil then pos = asap.heroPos end   -- fallback to last known
   asap.heroPos = pos                          -- keep latest for the debug line

   --   (b) Move the camera onto that pos and hold it (keepLocked=true prevents the
   --       default match camera / player input from drifting it away).
   safe(function() Camera_MoveTo(pos, false, nil, true) end)

   --   (c) Belt-and-braces: also FOLLOW the squad group. Camera_Follow(sgroup)
   --       resolves to Camera_FollowSquad(SGroup_GetSpawnedSquadAt(sg,1)) (verified
   --       camera.scar:110-114) -- the most robust "look at this actual unit" call.
   safe(function() Camera_Follow(asap.heroSg) end)

   -- GEN9 on-screen debug: prove where the camera was told to point.
   local cx, cz = asap_xz(pos)
   asap_dbg("CAM->HERO x=" .. tostring(math.floor(cx))
            .. " z=" .. tostring(math.floor(cz))
            .. " pin=" .. tostring(asap.pinTicks), 1)
end

-- ---------------------------------------------------------------------------
-- GEN9/GEN10 PERSISTENCE pin: the default match camera can re-assert after our
-- one-shot lock. Re-run the frame on a short interval so the view stays on the
-- target for the capture window, then stop so we don't burn CPU forever. Driven by
-- Rule_AddInterval(fn, interval, priority) (verified rulesystem.scar:47).
-- GEN10: retargeted at the ISOLATED photo hero (sg_photo) so the pinned frame is
-- the clean side-on insignia shot; falls back to the Gen9 hero row if none spawned.
function ASAPVerify_PinHero()
   if not (asap.photoReady or asap.heroReady) then
      safe(function() Rule_RemoveMe() end)   -- nothing to pin -> self-remove
      return
   end
   asap.pinTicks = asap.pinTicks + 1
   if asap.photoReady then
      ASAPVerify_FramePhotoHero()   -- GEN10: pin the ISOLATED side-on photo hero
   else
      ASAPVerify_FrameHero()        -- fallback: the Gen9 hero row
   end
   -- ~0.5 s cadence for ~30 s = 60 ticks, then stop re-pinning (keepLocked holds it).
   if asap.pinTicks >= 60 then
      safe(function() Rule_RemoveMe() end)
   end
end

-- ---------------------------------------------------------------------------
-- Frame the whole grid (wide shot). Deferred so terrain/units settle.
function ASAPVerify_FrameCamera()
   safe(function()
      Camera_MoveTo(asap.center, false)
   end)
   -- Zoom out so the whole grid fits (set-zoom-limit.scar pattern).
   safe(function()
      Camera_SetTuningValue(TV_DistMax, 4 * Camera_GetTuningValue(TV_DistMax))
   end)
end

-- ---------------------------------------------------------------------------
-- Camera cycle: 0 = wide shot (held), then step close to each vehicle in turn,
-- then loop. Driven by a repeating Rule_AddInterval tick (~6 s cadence). All
-- moves are guarded; a nil cell just advances the cycle.
function ASAPVerify_CameraCycle()
   local n = table.getn(VEHICLE_SBP_NAMES)
   asap.cycleIndex = asap.cycleIndex + 1
   if asap.cycleIndex > n then
      -- Full pass done -> back to the wide shot, then start over.
      asap.cycleIndex = 0
      ASAPVerify_FrameCamera()
      return
   end
   local pos = asap.cellPos[asap.cycleIndex]
   if pos ~= nil then
      safe(function()
         -- Close-up: move the camera onto this cell. keepLocked=false so the
         -- default zoom (reset a bit tighter) gives a per-vehicle close shot.
         Camera_MoveTo(pos, false)
      end)
      safe(function()
         -- Tighten the zoom for the close-up (reset toward default max).
         Camera_SetTuningValue(TV_DistMax, Camera_GetTuningValue(TV_DistMax))
      end)
   end
end

-- ---------------------------------------------------------------------------
function ASAPVerify_Setup()
   -- 1) Player 1 + start position (R2).
   safe(function() asap.player = World_GetPlayerAt(1) end)

   -- 2) Resources / pop cap so nothing decays and the grid is buildable-cost-free.
   safe(function() Player_SetPopCapOverride(asap.player, 999) end)

   -- 3) Anchor the grid near player 1's starting position (R2), fall back to
   --    world origin (0,0) if the call is unavailable on this map.
   safe(function() asap.origin = Player_GetStartingPosition(asap.player) end)
   if asap.origin == nil then
      safe(function() asap.origin = Util_ScarPos(0, 0) end)
   end

   -- Precompute the grid centre for the wide-shot camera target.
   local n = table.getn(VEHICLE_SBP_NAMES)
   local rows = math.floor((n - 1) / GRID_COLS) + 1
   local ox, oz = 0, 0
   if asap.origin ~= nil then
      pcall(function() ox = asap.origin.x end)
      pcall(function() oz = asap.origin.z end)
   end
   local cx = ox + ((GRID_COLS - 1) * GRID_SPACING) / 2
   local cz = oz + ((rows - 1) * GRID_SPACING) / 2
   safe(function() asap.center = Util_ScarPos(cx, cz) end)

   -- 4) Reveal the whole map so fog never hides the grid.
   safe(function() FOW_RevealAll() end)

   -- 5) Spawn the vehicle grid (wide decal-match evidence, kept intact).
   safe(function() ASAPVerify_SpawnGrid() end)

   -- 5b) Spawn the HERO insignia close-up target(s) (GEN8): a side-on German tank
   --     row so the balkenkreuz on the hull SIDE faces CoH2's fixed camera.
   safe(function() ASAPVerify_SpawnHero() end)

   -- 5c) GEN12: spawn the THREE side-on "photo heroes" (sg_photo) on the open ground
   --     near the grid (origin +14, z={-10,0,+10}), each facing a different way, so a
   --     screenshot frames the middle hero's hull-side balkenkreuz with the trio close.
   safe(function() ASAPVerify_SpawnPhotoHero() end)
   safe(function() PrintOnScreen("GEN12 TRIPLE PHOTO HERO") end)

   -- 6) Brief wide-grid establishing shot (deferred 1.5 s so units settle).
   safe(function() Rule_AddOneShot(ASAPVerify_FrameCamera, 1.5, 1000) end)

   -- 7) GEN9/GEN10: after a short wide-grid hold, lock LOW + CLOSE + SIDE-ON on the
   --    ISOLATED photo hero (sg_photo) and KEEP IT PINNED via a 0.5 s interval for
   --    ~30 s so the default match camera can't re-assert onto the empty player-start
   --    (the exact Gen8 failure). The pin re-reads the photo hero's LIVE position from
   --    its SGroup each tick. Falls back to the Gen9 hero row, then the grid cycle.
   safe(function()
      Rule_AddOneShot(function()
         if asap.photoReady then
            asap.pinTicks = 0
            ASAPVerify_FramePhotoHero()                         -- GEN10 immediate lock
            safe(function() Rule_AddInterval(ASAPVerify_PinHero, 0.5, 1003) end)  -- persistence -> sg_photo
         elseif asap.heroReady then
            asap.pinTicks = 0
            ASAPVerify_FrameHero()                              -- fallback: Gen9 hero row
            safe(function() Rule_AddInterval(ASAPVerify_PinHero, 0.5, 1003) end)  -- persistence
         else
            -- No hero -> fall back to the original per-vehicle grid close-up cycle.
            asap.cycleIndex = 0
            asap_dbg("HERO FALLBACK: no hero spawned, cycling grid", 1)
            Rule_AddInterval(ASAPVerify_CameraCycle, 6, 1001)
         end
      end, HERO_HOLD_DELAY + 5, 1002)
   end)

   -- 8) OCR marker for the harness. dr_text2d draws normalized-coord screen text.
   --    GEN9: RGB is 0..255 (Gen8 used 1,1,1 = near-black/invisible). 255,255,255.
   safe(function()
      dr_clear("asap_marker")
      dr_setautoclear("asap_marker", false)
      dr_text2d("asap_marker", 0.02, 0.02, "ASAP_VERIFY_READY", 255, 255, 255)
   end)
   -- Alt/backup centre-screen marker (bigger); harmless if unavailable.
   safe(function() PrintOnScreen("ASAP_VERIFY_READY") end)
end

-- ---------------------------------------------------------------------------
Scar_AddInit(ASAPVerify_Setup)   -- entry point (confirmed convention)
`

// ---------------------------------------------------------------------------
// preview.tga — a tiny valid 128x128 uncompressed 24-bit TGA (§1: optional but
// keep it). Solid dark-grey field; enough for a valid lobby thumbnail.
// ---------------------------------------------------------------------------
function makeTga(width = 128, height = 128): Uint8Array {
  const header = new Uint8Array(18)
  header[2] = 2 // uncompressed true-color
  header[12] = width & 0xff
  header[13] = (width >> 8) & 0xff
  header[14] = height & 0xff
  header[15] = (height >> 8) & 0xff
  header[16] = 24 // bits per pixel
  const pixels = new Uint8Array(width * height * 3)
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = 0x28 // B
    pixels[i + 1] = 0x28 // G
    pixels[i + 2] = 0x28 // R
  }
  const out = new Uint8Array(header.length + pixels.length)
  out.set(header, 0)
  out.set(pixels, header.length)
  return out
}

// ---------------------------------------------------------------------------
// Assemble + pack the mod SGA. buildSga normalizes to backslash + DFS folder
// order internally. We pass forward-slash paths; the writer converts.
//
// GEN4 (2026-07-19) — the DRIVE-LAYOUT fix. In-game evidence (Gen3, driven via
// the harness) proved the mod BOOTS to menu but is STILL ABSENT from the lobby
// Win-Condition dropdown even with `.win` storage=1. So `.win` storage was NOT
// the registration mechanism. Byte-level TOC dump of all 5 working subscribed
// gamemode mods (353675196 / 333857863 / 481822725 / 606599092 / 1660217730)
// shows the decisive field:
//
//   EVERY working mod emits EXACTLY 2 drives — data(0) then info(1) — with NO
//   attrib/locale drive. `.win`/`.scar` live on the `data` drive; the root
//   `<GUID>.info` + preview live on `info`. Our Gen1–Gen3 builds emitted the
//   4 canonical skin-pack drives (attrib/locale/info/data), pushing `data` to
//   drive index 3. CoH2's win-condition scanner only registers a mod into the
//   dropdown when the archive's PRIMARY drive is `data` (index 0, root folder 0);
//   with `data` at index 3 the `.win` entries are never string-indexed → the mod
//   loads + boots but is silently UNLISTED.
//
// Gen4 therefore passes driveLayout:'gamemode' so the writer emits the 2-drive
// data-first layout that matches all 5 working mods. `.win` stays storage=1
// (still required, same as .ucs). All verification bytes stay 0 (our packs are
// unsigned [Sig:0]; the working mods' verif=4/1 are RSA-signed-TOC artifacts).
//
// BOOT-SAFETY vs Gen2: Gen2's `dropEmptyDrives` also produced 2 drives, but in
// canonical INDEX order → info(0)+data(1), which crashed at boot
// (`'<GUID>.info' is corrupt!`, archive.cpp/130). Gen4's 'gamemode' layout emits
// data FIRST, info SECOND — the exact order the 5 working mods use and all boot
// cleanly. The TOC round-trips through our own reader and is byte-structurally
// identical (drive/folder/file ranges) to 333857863's data/info layout.
// ---------------------------------------------------------------------------
// GEN6: all text payloads are CRLF-normalised (crlf()) so the packed bytes carry
// 0x0D like every working listed mod. .info + preview.tga now use storage=1
// ('stream') — byte-verified as the universal choice across all 5 working mods
// (.info storage=1 in all 5; preview/*.tga storage=1 in all 3 that ship one).
// .win stays storage=1 ('stream'); .scar stays storage=2 (writer default 'buffer').
// GEN7 (2026-07-19) — PER-FILE VERIFICATION HASHES. The root cause of "boots but
// never lists" survived Gen4/5/6: our SGA wrote verification=none(0) for every
// file, but the lobby scanner REQUIRES per-file verification hashes on win-
// condition files. Reverse-engineered byte-for-byte from the ModBuilder-burned
// reference (asap_verify.burned.sga, GUID ae9c499b…) + working 1660217730.sga,
// and pinned by the burn's ArchiveDefinition.txt:
//   data TOC defverification="sha1_blocks"  → .win/.scar : verification 'sha1_blocks'
//   info TOC defverification="crc_blocks"   → .info/.tga : verification 'crc_blocks'
// Compression per ArchiveDefinition + working-mod ground truth:
//   .win  → stream_compress (storage=1)   .scar → buffer_compress (storage=2)
//   .info → stream_compress (storage=1)   .tga  → stream_compress (storage=1)
// sha1_blocks = SHA-1 over the STORED (compressed) bytes per 262144 block; the
// crc32 field of every verified file is CRC32 over the STORED bytes. (Both proven
// by byte-match against the reference — see scripts' post-build validation.)
const files = [
  // .win — sha1_blocks + storage=1 (stream). CoH2 string-indexes the win-condition
  // like a .ucs locale entry; storage=2 silently drops it (kept from Gen3).
  { path: `game/winconditions/${WIN_STEM}.win`, bytes: enc(crlf(WIN_TEXT)), storage: 'stream' as const, verification: 'sha1_blocks' as const },
  // .scar — sha1_blocks + storage=2 (buffer), CRLF text.
  { path: `scar/winconditions/${WIN_STEM}.scar`, bytes: enc(crlf(SCAR_TEXT)), storage: 'buffer' as const, verification: 'sha1_blocks' as const },
  // .info — crc_blocks + storage=1 ('stream') to match all 5 working mods.
  { path: `${MODGUID}.info`, bytes: enc(crlf(INFO_TEXT)), storage: 'stream' as const, verification: 'crc_blocks' as const },
  // preview.tga — crc_blocks + storage=1 (info-drive file; working mods store info-
  // drive .dds/.tga with verif=1/crc_blocks; storage=1 matches the 3 mods w/ a tga).
  { path: `preview.tga`, bytes: makeTga(), storage: 'stream' as const, verification: 'crc_blocks' as const },
]

// driveLayout:'gamemode' → 2 drives data(0)+info(1) (matches all 5 working mods).
const sga = await buildSga({ archiveName: MODGUID, files, driveLayout: 'gamemode' })

// ---------------------------------------------------------------------------
// Write the SGA to the artifacts dir first (for inspection + parse-back).
// ---------------------------------------------------------------------------
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'ingame-verify')
await mkdir(ARTIFACT_DIR, { recursive: true })
const OUT_SGA = path.join(ARTIFACT_DIR, `${MODGUID}.sga`)
await writeFile(OUT_SGA, sga)
console.log(`[build] wrote ${OUT_SGA} (${sga.length} bytes)`)

// ---------------------------------------------------------------------------
// Parse the SGA back with the repo's own reader — confirm layout + payloads.
// ---------------------------------------------------------------------------
const arc = await SgaArchive.open(new Blob([sga]))
const paths = arc.listPaths().sort()
console.log('[verify] SGA parsed back. Contents:')
for (const p of paths) console.log('   ', p)

const expected = [
  `${MODGUID}.info`,
  `game/winconditions/${WIN_STEM}.win`,
  `preview.tga`,
  `scar/winconditions/${WIN_STEM}.scar`,
].sort()
const layoutOk = JSON.stringify(paths) === JSON.stringify(expected)
console.log(`[verify] layout matches design doc §1: ${layoutOk ? 'YES' : 'NO'}`)
if (!layoutOk) {
  console.error('   expected:', expected)
  console.error('   got     :', paths)
  process.exit(1)
}

// Round-trip the text payloads to confirm they decode cleanly.
const dec = new TextDecoder('utf-8', { fatal: false })
const winBack = await arc.readByPath(`game/winconditions/${WIN_STEM}.win`)
const scarBack = await arc.readByPath(`scar/winconditions/${WIN_STEM}.scar`)
const infoBack = await arc.readByPath(`${MODGUID}.info`)
// GEN6: payloads are packed as crlf(TEXT), so round-trip against the CRLF form.
const winOk = winBack != null && dec.decode(winBack) === crlf(WIN_TEXT)
const scarOk = scarBack != null && dec.decode(scarBack) === crlf(SCAR_TEXT)
const infoOk = infoBack != null && dec.decode(infoBack) === crlf(INFO_TEXT)
console.log(`[verify] .win round-trip:  ${winOk ? 'OK' : 'FAIL'}`)
console.log(`[verify] .scar round-trip: ${scarOk ? 'OK' : 'FAIL'}`)
console.log(`[verify] .info round-trip: ${infoOk ? 'OK' : 'FAIL'}`)
if (!winOk || !scarOk || !infoOk) process.exit(1)

// GEN6 CRLF assertion — the decisive listing fix. Byte-count 0x0D (CR) in the
// PACKED-then-decoded payloads; every working listed mod has CR>0 in .win/.info/
// .scar. LF-only (CR=0) is exactly what kept our mode off the dropdown.
{
  const cr = (b: Uint8Array | null) => (b ? b.reduce((n, x) => n + (x === 0x0d ? 1 : 0), 0) : 0)
  const winCR = cr(winBack)
  const infoCR = cr(infoBack)
  const scarCR = cr(scarBack)
  console.log(`[verify] .win  CRLF (0x0D count > 0):          ${winCR > 0 ? `OK (${winCR})` : 'FAIL (0)'}`)
  console.log(`[verify] .info CRLF (0x0D count > 0):          ${infoCR > 0 ? `OK (${infoCR})` : 'FAIL (0)'}`)
  console.log(`[verify] .scar CRLF (0x0D count > 0):          ${scarCR > 0 ? `OK (${scarCR})` : 'FAIL (0)'}`)
  // .scar must import the base annihilate win-condition so a started match is valid.
  const scarStr = scarBack != null ? dec.decode(scarBack) : ''
  const hasAnnihilate = scarStr.includes('import("winconditions/annihilate.scar")')
  console.log(`[verify] .scar imports annihilate.scar:        ${hasAnnihilate ? 'OK' : 'FAIL'}`)
  if (winCR === 0 || infoCR === 0 || scarCR === 0 || !hasAnnihilate) {
    console.error('[verify] GEN6 assertions failed — mode would boot but not list, or match would not start.')
    process.exit(1)
  }
}

// GEN5 content assertions — the .win must carry a resolvable LITERAL lobby label
// AND a "complete" mode-metadata block (entity_replacements) exactly like every
// working listed mod. Without these the mode boots but is dropped from the lobby
// Win-Condition dropdown.
{
  const winStr = winBack != null ? dec.decode(winBack) : ''
  const feLiteral = /fe_name\s*=\s*"[^"$]+"/.test(winStr) // literal, not $UCS key
  const feExact = winStr.includes(`fe_name = "${FE_NAME}"`)
  const hasEntityReplacements = /entity_replacements\s*=\s*\{/.test(winStr)
  console.log(`[verify] .win fe_name is LITERAL (no $UCS):    ${feLiteral ? 'OK' : 'FAIL'}`)
  console.log(`[verify] .win fe_name == "${FE_NAME}":         ${feExact ? 'OK' : 'FAIL'}`)
  console.log(`[verify] .win has entity_replacements block:   ${hasEntityReplacements ? 'OK' : 'FAIL'}`)
  if (!feLiteral || !feExact || !hasEntityReplacements) {
    console.error('[verify] GEN5 content assertions failed — mode would boot but not list.')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// GEN4/GEN6 assertions — re-parse the raw TOC and confirm the DRIVE-LAYOUT +
// storage fixes that make the win-condition LIST while staying boot-safe:
//   - EXACTLY 2 drives, in order DRIVE[0]="data", DRIVE[1]="info" (matches all 5
//     working mods; data-first is required for BOTH lobby listing AND boot-safety
//     — Gen2's info-first 2-drive layout crashed at boot).
//   - DRIVE[0] (data) root folder index 0; DRIVE[1] (info) root just past data's
//     folders — i.e. data's folders precede info's (index bases ascend data→info).
//   - `.win`/`.info`/`.tga` storage == 1 (stream); `.scar` storage == 2 (buffer).
// GEN7 (verification hashes) assertions are in the separate block below.
// Any regression here risks losing the lobby listing or the Gen2 boot crash, so
// fail the build loudly.
// ---------------------------------------------------------------------------
{
  const dv = new DataView(sga.buffer, sga.byteOffset, sga.byteLength)
  const headerSize = dv.getUint32(140, true)
  const toc = new DataView(sga.buffer, sga.byteOffset + 152, headerSize)
  const drivePos = toc.getUint32(0, true)
  const driveCount = toc.getUint32(4, true)
  const filePos = toc.getUint32(16, true)
  const fileCount = toc.getUint32(20, true)
  const namePos = toc.getUint32(24, true)
  const nameAt = (rel: number) => {
    let e = namePos + rel
    while (e < headerSize && toc.getUint8(e) !== 0) e++
    return new TextDecoder().decode(new Uint8Array(sga.buffer, sga.byteOffset + 152 + namePos + rel, e - (namePos + rel)))
  }
  // Drive records: 148 bytes each; alias is a NUL-padded latin1 string at +0,
  // rootFolder u32 at +144, folderFirst u32 at +128.
  const driveAt = (i: number) => {
    const o = drivePos + i * 148
    let e = o
    while (e < headerSize && toc.getUint8(e) !== 0) e++
    const alias = new TextDecoder().decode(new Uint8Array(sga.buffer, sga.byteOffset + 152 + o, e - o))
    return { alias, folderFirst: toc.getUint32(o + 128, true), rootFolder: toc.getUint32(o + 144, true) }
  }
  const rec: Record<string, { storage: number; verif: number }> = {}
  for (let i = 0; i < fileCount; i++) {
    const o = filePos + i * 30
    rec[nameAt(toc.getUint32(o, true))] = { verif: toc.getUint8(o + 20), storage: toc.getUint8(o + 21) }
  }
  const winRec = rec[`${WIN_STEM}.win`]
  const scarRec = rec[`${WIN_STEM}.scar`]
  const infoRec = rec[`${MODGUID}.info`]
  const tgaRec = rec['preview.tga']
  const d0 = driveCount >= 1 ? driveAt(0) : null
  const d1 = driveCount >= 2 ? driveAt(1) : null
  const drivesOk = driveCount === 2
  const driveOrderOk = d0?.alias === 'data' && d1?.alias === 'info'
  const rootOk = d0?.rootFolder === 0 && (d1?.rootFolder ?? 0) === (d1?.folderFirst ?? -1) && (d1?.rootFolder ?? 0) > 0
  const winStorageOk = winRec?.storage === 1
  const scarStorageOk = scarRec?.storage === 2
  // GEN6: .info + preview.tga now storage=1 (was 2) — matches all 5 working mods.
  const infoStorageOk = infoRec?.storage === 1
  const tgaStorageOk = tgaRec?.storage === 1
  console.log(`[verify] drive count == 2 (gamemode layout): ${drivesOk ? 'OK' : `FAIL (${driveCount})`}`)
  console.log(`[verify] drive order == data,info:            ${driveOrderOk ? 'OK' : `FAIL (${d0?.alias},${d1?.alias})`}`)
  console.log(`[verify] data root=0, info root>data folders:  ${rootOk ? 'OK' : `FAIL (data root=${d0?.rootFolder}, info root=${d1?.rootFolder})`}`)
  console.log(`[verify] .win  storage == 1 (stream):          ${winStorageOk ? 'OK' : `FAIL (${winRec?.storage})`}`)
  console.log(`[verify] .scar storage == 2 (buffer):          ${scarStorageOk ? 'OK' : `FAIL (${scarRec?.storage})`}`)
  console.log(`[verify] .info storage == 1 (stream) [GEN6]:   ${infoStorageOk ? 'OK' : `FAIL (${infoRec?.storage})`}`)
  console.log(`[verify] .tga  storage == 1 (stream) [GEN6]:   ${tgaStorageOk ? 'OK' : `FAIL (${tgaRec?.storage})`}`)

  // GEN11 (2026-07-21) — EMPTY-FOLDER FILE-RANGE ANCHOR (the true Gen10 listing
  // regression). The intermediate `scar` folder has NO direct files (its file
  // lives in `scar\winconditions`), so its [fileFirst,fileLast) is an EMPTY range.
  // The engine anchors that empty range at the index of the FIRST file in the
  // folder's SUBTREE — i.e. the `.scar` file's index — NOT at the drive's first
  // file (index 0, the `.win`). Byte-verified across the ModBuilder burn
  // (scar→file[1..1]) and all 4 working mods (scar→file[10/18/20..], = where
  // scar\winconditions begins). The Gen10 build wrongly emitted scar→file[0..0]
  // (old driveFileStart fallback), which pointed the scar folder's range at the
  // `.win` instead of the `.scar`; the scanner's walk of the scar subtree was
  // corrupted, so the win-condition `.scar` was never enumerated and the mode
  // MOUNTED clean [Sig:0] but was DROPPED from the lobby dropdown. Fixed in
  // src/lib/sga-writer.ts (subtree-first-file anchor). Assert here so it can't
  // silently regress again.
  const folderPos = toc.getUint32(8, true)
  const folderCount = toc.getUint32(12, true)
  const folderAt = (i: number) => {
    const o = folderPos + i * 20
    const namePos2 = toc.getUint32(o, true)
    let e = namePos + namePos2
    while (e < headerSize && toc.getUint8(e) !== 0) e++
    const name = new TextDecoder().decode(
      new Uint8Array(sga.buffer, sga.byteOffset + 152 + namePos + namePos2, e - (namePos + namePos2)))
    return { name, fileFirst: toc.getUint32(o + 12, true), fileLast: toc.getUint32(o + 16, true) }
  }
  // Locate the `.scar`'s file index and the intermediate `scar` folder.
  let scarFileIdx = -1
  for (let i = 0; i < fileCount; i++) {
    if (nameAt(toc.getUint32(filePos + i * 30, true)) === `${WIN_STEM}.scar`) { scarFileIdx = i; break }
  }
  let scarFolder: { name: string; fileFirst: number; fileLast: number } | null = null
  let scarWinFolder: { name: string; fileFirst: number; fileLast: number } | null = null
  for (let i = 0; i < folderCount; i++) {
    const f = folderAt(i)
    if (f.name === 'scar') scarFolder = f
    if (f.name === 'scar\\winconditions') scarWinFolder = f
  }
  // The empty `scar` folder must anchor at the `.scar` index (== where
  // scar\winconditions's files begin), and be an empty range there.
  const scarAnchorOk =
    scarFolder != null && scarWinFolder != null && scarFileIdx >= 0 &&
    scarFolder.fileFirst === scarFileIdx && scarFolder.fileLast === scarFileIdx &&
    scarWinFolder.fileFirst === scarFileIdx
  console.log(`[verify] scar folder anchored at .scar idx ${scarFileIdx} [GEN11]: ${scarAnchorOk ? 'OK' : `FAIL (scar folder=[${scarFolder?.fileFirst}..${scarFolder?.fileLast}], scar\\winconditions first=${scarWinFolder?.fileFirst})`}`)

  if (!drivesOk || !driveOrderOk || !rootOk || !winStorageOk || !scarStorageOk || !infoStorageOk || !tgaStorageOk || !scarAnchorOk) {
    console.error('[verify] GEN4/GEN6/GEN11 assertions failed — would risk boot crash or lost lobby listing.')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// GEN7 assertions — PER-FILE VERIFICATION HASHES (the root cause of "boots but
// never lists"). Confirm, byte-for-byte against a fresh recomputation:
//   - .win/.scar verification byte == 4 (sha1_blocks); .info/.tga == 1 (crc_blocks).
//   - Each sha1_blocks file's hash block, read via its `hash_pos` from the TOC
//     hash table at `sig_offset`, equals SHA-1 over the STORED (compressed) bytes.
//   - Each verified file's crc32 field == CRC32 over the STORED bytes.
// This matches the ModBuilder-burned reference (asap_verify.burned.sga) scheme
// exactly. Without these hashes the mode boots [Sig:0] but is dropped from the
// lobby dropdown; fail loudly on any regression.
// ---------------------------------------------------------------------------
{
  const { createHash } = await import('node:crypto')
  const zlib = await import('node:zlib')
  const crcTable = (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c }
    return t
  })()
  const crc32 = (buf: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff]; return (c ^ 0xffffffff) >>> 0 }

  const dv = new DataView(sga.buffer, sga.byteOffset, sga.byteLength)
  const headerSize = dv.getUint32(140, true)
  const dataPos = dv.getUint32(144, true)
  const H = 152
  const t = (o: number) => dv.getUint32(H + o, true)
  const filePos = t(16), fileCount = t(20), namePos = t(24), sigOffset = t(32), pageSize = t(36)
  const sigAbs = H + sigOffset
  const nameAt = (rel: number) => {
    let e = H + namePos + rel
    while (e < H + headerSize && sga[e] !== 0) e++
    return new TextDecoder().decode(sga.subarray(H + namePos + rel, e))
  }
  const EXPECT: Record<string, number> = {
    [`${WIN_STEM}.win`]: 4, [`${WIN_STEM}.scar`]: 4,
    [`${MODGUID}.info`]: 1, ['preview.tga']: 1,
  }
  const BS = pageSize || 262144
  let allOk = true
  for (let i = 0; i < fileCount; i++) {
    const o = H + filePos + i * 30
    const nm = nameAt(dv.getUint32(o, true))
    const dPos = dv.getUint32(o + 4, true), store = dv.getUint32(o + 8, true)
    const verif = sga[o + 20], storage = sga[o + 21]
    const crcField = dv.getUint32(o + 22, true), hashPos = dv.getUint32(o + 26, true)
    const stored = sga.subarray(dataPos + dPos, dataPos + dPos + store)
    const raw = storage === 0 ? stored : new Uint8Array(zlib.inflateSync(Buffer.from(stored)))
    const want = EXPECT[nm]
    // raw decompresses to declared length
    const declaredLen = dv.getUint32(o + 12, true)
    const rawLenOk = raw.length === declaredLen
    const verifByteOk = verif === want
    const crcOk = crcField === crc32(stored)
    let sha1Ok = true
    if (want === 4) {
      const nBlocks = Math.max(1, Math.ceil(store / BS))
      for (let b = 0; b < nBlocks; b++) {
        const blk = stored.subarray(b * BS, (b + 1) * BS)
        const expect = createHash('sha1').update(blk).digest()
        const got = sga.subarray(sigAbs + hashPos + b * 20, sigAbs + hashPos + b * 20 + 20)
        if (Buffer.compare(expect, Buffer.from(got)) !== 0) sha1Ok = false
      }
    }
    const ok = verifByteOk && crcOk && sha1Ok && rawLenOk
    if (!ok) allOk = false
    console.log(`[verify] ${nm.padEnd(42)} verif=${verif}(want ${want}) crc=${crcOk ? 'OK' : 'FAIL'} ${want === 4 ? `sha1=${sha1Ok ? 'OK' : 'FAIL'} ` : ''}rawLen=${rawLenOk ? 'OK' : 'FAIL'}`)
  }
  console.log(`[verify] GEN7 per-file verification hashes:    ${allOk ? 'OK' : 'FAIL'}`)
  if (!allOk) {
    console.error('[verify] GEN7 verification-hash assertions failed — mode would boot [Sig:0] but stay off the lobby dropdown.')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// INSTALL: write the fixed SGA to BOTH the gamemode root AND subscriptions/
// (belt-and-braces — the game dedupes by GUID, and every working gamemode mod
// on this box lives under subscriptions/, so we cover both). Same MODGUID as
// the old broken build, so both copies OVERWRITE the broken ones in place — no
// duplicate-GUID conflict is possible (content GUID unchanged).
// ---------------------------------------------------------------------------
const GAMEMODE_DIR =
  '/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/gamemode'
const SUBS_DIR = path.join(GAMEMODE_DIR, 'subscriptions')
if (!existsSync(GAMEMODE_DIR)) {
  console.error(`[install] gamemode dir missing: ${GAMEMODE_DIR}`)
  process.exit(1)
}
await mkdir(SUBS_DIR, { recursive: true })
const INSTALL_PATHS = [
  path.join(GAMEMODE_DIR, `${MODGUID}.sga`),
  path.join(SUBS_DIR, `${MODGUID}.sga`),
]
for (const p of INSTALL_PATHS) {
  await copyFile(OUT_SGA, p)
  console.log(`[install] copied to ${p}`)
}
const INSTALL_PATH = INSTALL_PATHS[0]

console.log('\n[done] ASAP Verify gamemode built + installed.')
console.log(`  MODGUID     : ${MODGUID}`)
console.log(`  fe_name     : "${FE_NAME}"  (lobby dropdown label)`)
console.log(`  artifact SGA: ${OUT_SGA}`)
console.log(`  installed   : ${INSTALL_PATH}`)
