#pragma once

/**
 * steam_loop — libuv timer that calls SteamAPI_RunCallbacks every 100 ms.
 */

/** Start the pump. Idempotent — safe to call multiple times. */
void steam_loop_start(void* uv_loop);

/** Stop the pump. Idempotent. */
void steam_loop_stop();
