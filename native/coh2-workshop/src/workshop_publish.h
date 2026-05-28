#pragma once
#include <napi.h>

/**
 * publishNewItem(input: PublishInput): Promise<PublishResult>
 *
 * Publishes a NEW Workshop item via ISteamRemoteStorage::PublishWorkshopFile.
 * The sgaPath file is written to Steam Cloud, shared for a UGCHandle, then
 * PublishWorkshopFile is called to create the item.
 *
 * Requires that Steam is already initialised (steamworks.js called SteamAPI_Init)
 * and that steam_bridge_init() has been called successfully.
 */
Napi::Value publishNewItem(const Napi::CallbackInfo& info);
