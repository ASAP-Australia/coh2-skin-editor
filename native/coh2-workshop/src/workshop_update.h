#pragma once
#include <napi.h>

/**
 * updateExistingItem(input: UpdateInput): Promise<PublishResult>
 *
 * Updates an existing Workshop item via ISteamRemoteStorage update path.
 * The item must have been originally published via publishNewItem (legacy path).
 */
Napi::Value updateExistingItem(const Napi::CallbackInfo& info);
