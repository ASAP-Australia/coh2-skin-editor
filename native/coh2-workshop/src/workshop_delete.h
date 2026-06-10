#pragma once
#include <napi.h>

/**
 * jsDeletePublishedItem(publishedFileId: bigint): Promise<{ publishedFileId: bigint }>
 *
 * Deletes an existing Workshop item via ISteamRemoteStorage::DeletePublishedFile.
 * The item must have been originally published by the current user.
 *
 * Accepts a single BigInt argument (the published file id to delete).
 *
 * Requires that Steam is already initialised (steamworks.js called SteamAPI_Init)
 * and that steam_bridge_init() has been called successfully.
 */
Napi::Value jsDeletePublishedItem(const Napi::CallbackInfo& info);
