/**
 * coh2-workshop native addon
 *
 * Publishes and updates CoH2 Workshop items via the legacy
 * ISteamRemoteStorage API path (PublishWorkshopFile / CommitPublishedFileUpdate).
 *
 * CoH2 (app 231430) does NOT have a modern ISteamUGC content depot, so the
 * standard steamworks.js createItem + updateItem route always fails with
 * "a parameter is invalid". This addon uses the proven legacy path.
 *
 * NOTE: updateExistingItem can only update items originally published via
 * publishNewItem (i.e. via this legacy path). Items created through the
 * modern UGC API cannot be updated here.
 */

export interface PublishInput {
  /** Absolute path to the .sga file on disk */
  sgaPath: string
  /** Absolute path to the preview image (.png or .jpg, < 1 MB) */
  previewPath: string
  /** Steam App ID of the consumer app (231430 for CoH2) */
  appId: number
  /** Workshop item title (1–128 characters) */
  title: string
  /** Workshop item description (up to 8000 characters) */
  description: string
  /** Visibility: 0=Public, 1=FriendsOnly, 2=Private, 3=Unlisted */
  visibility: 0 | 1 | 2 | 3
  /** Workshop tags, e.g. ['Decal'], ['Skin'], ['Faceplate'] */
  tags: string[]
  /** Change description shown on the Workshop page. Defaults to 'Initial upload' */
  changeNote?: string
}

export interface UpdateInput extends PublishInput {
  /** The existing Workshop item ID to update */
  publishedFileId: bigint
}

export interface PublishResult {
  /** The newly allocated or updated Workshop item ID */
  publishedFileId: bigint
  /** True if the user must accept the Workshop Subscriber Agreement */
  agreementNeeded: boolean
}

/**
 * Publishes a NEW Workshop item via the legacy ISteamRemoteStorage API.
 *
 * Sequence:
 *  1. FileWrite + FileShare → UGCHandle
 *  2. Preview FileWrite (Steam reads from cloudPreviewPath during publish)
 *  3. PublishWorkshopFile → publishedFileId
 */
export function publishNewItem(input: PublishInput): Promise<PublishResult>

/**
 * Updates an EXISTING Workshop item via the legacy ISteamRemoteStorage API.
 *
 * IMPORTANT: Only items previously published via publishNewItem can be updated.
 *
 * Sequence:
 *  1. FileWrite + FileShare → UGCHandle for new SGA content
 *  2. CreatePublishedFileUpdateRequest
 *  3. UpdatePublishedFile{File, PreviewFile, Title, Description, Visibility, Tags, ChangeDescription}
 *  4. CommitPublishedFileUpdate → result
 */
export function updateExistingItem(input: UpdateInput): Promise<PublishResult>

/**
 * Start a libuv timer that calls SteamAPI_RunCallbacks every 100 ms.
 *
 * Call this once from electron/main.ts after Steam is initialized.
 * Safe to call multiple times — the timer is only started once.
 *
 * If steamworks.js is already pumping callbacks, calling this is harmless
 * but may cause duplicate dispatches. In practice, steamworks.js v0.4 does
 * NOT run a background pump in the main process; it relies on game-loop
 * integration. So we need our own pump for the async callbacks to fire.
 */
export function startCallbackPump(): void

/**
 * Stop the callback pump timer (call before app exit if desired).
 * Safe to call even if the pump was never started.
 */
export function stopCallbackPump(): void
