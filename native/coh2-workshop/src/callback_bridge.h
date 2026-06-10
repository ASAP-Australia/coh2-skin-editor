#pragma once
#include <cstdint>

/**
 * callback_bridge — Steam flat-API function pointers.
 *
 * We use the Steam flat C API (SteamAPI_ISteamRemoteStorage_FileWrite etc.)
 * to avoid needing Steam SDK C++ headers. Function signatures are declared
 * here exactly as the proven reference C probe used them.
 *
 * Initialise once via steam_bridge_init() before calling anything else.
 * steam_bridge_init() does NOT call SteamAPI_Init — Steam must already be
 * initialised by steamworks.js in the same process.
 */

// ── Opaque interface pointers ──────────────────────────────────────────────
typedef void ISteamRemoteStorage;
typedef void ISteamUtils;

// ── Handle types ───────────────────────────────────────────────────────────
typedef uint64_t UGCHandle_t;
typedef uint64_t PublishedFileId_t;
typedef uint64_t PublishedFileUpdateHandle_t;
typedef uint64_t SteamAPICall_t;

static constexpr UGCHandle_t k_UGCHandleInvalid                     = 0xffffffffffffffffULL;
static constexpr PublishedFileUpdateHandle_t k_UpdateHandleInvalid   = 0xffffffffffffffffULL;

// ── SteamParamStringArray_t ────────────────────────────────────────────────
struct SteamParamStringArray_t {
    const char** ppStrings;
    int32_t      nNumStrings;
};

// ── Callback result structs ────────────────────────────────────────────────
// Callback IDs match what Valve documents:
//   RemoteStorageFileShareResult_t    = 1307
//   RemoteStoragePublishFileResult_t  = 1309
//   RemoteStorageUpdatePublishedFileResult_t = 1316

// Steam's callback result structs use 4-byte packing (the SDK wraps these in
// #pragma pack(push,4)). Without this, m_hFile / m_nPublishedFileId are read at
// the wrong offset on x86-64 (8-byte default alignment) — decoding garbage like
// 0x73646F6DFFFFFFFF ("mods" + 0xFFFFFFFF). m_eResult at offset 0 is unaffected.
#pragma pack(push, 4)
struct RemoteStorageFileShareResult_t {
    int32_t         m_eResult;        // EResult
    UGCHandle_t     m_hFile;
    char            m_rgchFilename[260];
};

struct RemoteStoragePublishFileResult_t {
    int32_t             m_eResult;
    PublishedFileId_t   m_nPublishedFileId;
    bool                m_bUserNeedsToAcceptWorkshopLegalAgreement;
};

struct RemoteStorageUpdatePublishedFileResult_t {
    int32_t             m_eResult;
    PublishedFileId_t   m_nPublishedFileId;
    bool                m_bUserNeedsToAcceptWorkshopLegalAgreement;
};

struct RemoteStorageDeletePublishedFileResult_t {
    int32_t           m_eResult;
    PublishedFileId_t m_nPublishedFileId;
};
#pragma pack(pop)

static constexpr int k_iCallback_FileShareResult           = 1307;
static constexpr int k_iCallback_PublishResult             = 1309;
static constexpr int k_iCallback_UpdateResult              = 1316;
static constexpr int k_iCallback_DeletePublishedFileResult = 1311;

// ── Bridge init ───────────────────────────────────────────────────────────
/**
 * Resolve all function pointers from the already-loaded libsteam_api.so.
 * Returns true on success. Logs missing symbols to stderr.
 * Call once at addon init time.
 */
bool steam_bridge_init();

// ── Interface accessors ───────────────────────────────────────────────────
ISteamRemoteStorage* steam_get_rs();
ISteamUtils*         steam_get_utils();

// ── Pump ─────────────────────────────────────────────────────────────────
void steam_run_callbacks();

// ── ISteamRemoteStorage functions ─────────────────────────────────────────
bool           rs_FileWrite(ISteamRemoteStorage* rs, const char* pchFile,
                            const void* pvData, int32_t cubData);

bool           rs_FileDelete(ISteamRemoteStorage* rs, const char* pchFile);

// Optional cloud-state probes. If the underlying Steam symbol is missing the
// wrappers degrade gracefully: rs_FileExists/rs_FilePersisted return true
// (assume ready) and rs_GetFileSize returns -1 (unknown).
bool           rs_FileExists(ISteamRemoteStorage* rs, const char* pchFile);
int32_t        rs_GetFileSize(ISteamRemoteStorage* rs, const char* pchFile);
bool           rs_FilePersisted(ISteamRemoteStorage* rs, const char* pchFile);

// Cloud-enable / quota probes + fixers. FileShare returns FileNotFound when the
// file was written locally but never uploaded to Steam's servers — which happens
// when Cloud is disabled for the app. These let us read that state and force it
// on. All degrade gracefully (probes return true / GetQuota returns false) if the
// underlying symbol is absent.
bool           rs_IsCloudEnabledForApp(ISteamRemoteStorage* rs);
bool           rs_IsCloudEnabledForAccount(ISteamRemoteStorage* rs);
void           rs_SetCloudEnabledForApp(ISteamRemoteStorage* rs, bool enabled);
bool           rs_GetQuota(ISteamRemoteStorage* rs, uint64_t* total, uint64_t* avail);
bool           rs_SetSyncPlatforms(ISteamRemoteStorage* rs, const char* pchFile, int32_t platforms);

SteamAPICall_t rs_FileShare(ISteamRemoteStorage* rs, const char* pchFile);

SteamAPICall_t rs_PublishWorkshopFile(
    ISteamRemoteStorage*  rs,
    const char*           pchFile,
    const char*           pchPreviewFile,
    uint32_t              nConsumerAppId,
    const char*           pchTitle,
    const char*           pchDescription,
    int32_t               eVisibility,
    SteamParamStringArray_t* pTags,
    int32_t               eWorkshopFileType);

PublishedFileUpdateHandle_t rs_CreatePublishedFileUpdateRequest(
    ISteamRemoteStorage* rs, PublishedFileId_t unPublishedFileId);

bool rs_UpdatePublishedFileFile(ISteamRemoteStorage* rs,
                                PublishedFileUpdateHandle_t handle,
                                UGCHandle_t hContent);

bool rs_UpdatePublishedFilePreviewFile(ISteamRemoteStorage* rs,
                                       PublishedFileUpdateHandle_t handle,
                                       const char* pchPreviewFile);

bool rs_UpdatePublishedFileTitle(ISteamRemoteStorage* rs,
                                 PublishedFileUpdateHandle_t handle,
                                 const char* pchTitle);

bool rs_UpdatePublishedFileDescription(ISteamRemoteStorage* rs,
                                       PublishedFileUpdateHandle_t handle,
                                       const char* pchDescription);

bool rs_UpdatePublishedFileVisibility(ISteamRemoteStorage* rs,
                                      PublishedFileUpdateHandle_t handle,
                                      int32_t eVisibility);

bool rs_UpdatePublishedFileTags(ISteamRemoteStorage* rs,
                                PublishedFileUpdateHandle_t handle,
                                SteamParamStringArray_t* pTags);

bool rs_UpdatePublishedFileSetChangeDescription(ISteamRemoteStorage* rs,
                                                PublishedFileUpdateHandle_t handle,
                                                const char* pchChangeDescription);

SteamAPICall_t rs_CommitPublishedFileUpdate(ISteamRemoteStorage* rs,
                                            PublishedFileUpdateHandle_t handle,
                                            const char* pchChangeDescription);

typedef SteamAPICall_t (*fp_DeletePublished)(ISteamRemoteStorage*, PublishedFileId_t);

SteamAPICall_t rs_DeletePublishedFile(ISteamRemoteStorage* rs, PublishedFileId_t id);

// ── ISteamUtils functions ─────────────────────────────────────────────────
bool utils_IsAPICallCompleted(ISteamUtils* utils,
                               SteamAPICall_t hSteamAPICall,
                               bool* pbFailed);

bool utils_GetAPICallResult(ISteamUtils* utils,
                             SteamAPICall_t hSteamAPICall,
                             void* pCallback, int cubCallback,
                             int iCallbackExpected, bool* pbFailed);

// ── EResult → string ─────────────────────────────────────────────────────
const char* eresult_to_string(int32_t eResult);
