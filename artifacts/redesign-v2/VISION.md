# App Vision — "Simple but Powerful" (user brief, 2026-07-24)

Verbatim-derived requirements from the user's spoken brief. This is the north star for all UI work.

## Philosophy
- **Dark mode. Simple but powerful.** Anyone should be able to make a skin, faceplate, or decal just by using the app. Never confusing. The current editor UI has "boxes and shit everywhere" — declutter aggressively.

## Zero-friction sync (hard requirement)
- **No save button. No export button. No sync button/toggle.** Remove them.
- Every edit, in every editor, **auto-saves and auto-syncs straight to the game** immediately. The sync engine (Live Sync) stays but becomes invisible and always-on.

## Start / new-pack flow
- StartScreen must **actually match lab01.dev UI experiment #1**: the black modal WITH the visible texture pattern on the black, the top-left border light effect, and the bottom-right border light effect. (Current state: color matches, but pattern + both corner lights are NOT visibly rendering — fix and verify with real screenshots.)
- **App window glass border (glass-frame wrapper): more gray/opaque like lab01 experiment #3.** "You shouldn't be able to see straight through."

## New Skin Pack flow
1. Click "New Skin Pack" → **faction chooser menu** (pick the faction for the pack).
2. Editor: **vehicle selector at the bottom** (only that faction's vehicles); **pack name top-center** (generic default name; click the label to rename).
3. Click a vehicle → an **"Edit vehicle" affordance appears (above the selector)** → opens the texture editor.
4. **Texture editor layout: 3D view on the LEFT, texture canvas on the RIGHT.** Tools at the BOTTOM; clicking a tool opens that tool's **options sub-menu directly above the toolbar**. **Back button top-left.**

## Faceplate editor
- Tools at the bottom (same pattern: tool options sub-menu above the toolbar).

## Decal editor
- **Faction chooser at creation** (must pick which faction the decal pack is for).
- Layout: **decal canvas on the RIGHT, live 3D vehicle preview on the LEFT** showing where the decal will appear on a real vehicle.

## Visual verification (process requirement)
- **Every screen in the app must be visually verified with real screenshots** (Electron, real GPU). There are known visual glitches. Claims of "it renders" are insufficient — look at the pixels.

## Out of scope for the app team
- In-game capture of the equipped/override assets — the user will handle in-game verification themselves.
