#include "callback_bridge.h"
#include <dlfcn.h>
#include <cstdio>
#include <cstring>

// ── Function pointer typedefs ───────────────────────────────────────────────

typedef ISteamRemoteStorage* (*fp_GetRS)();
typedef ISteamUtils*         (*fp_GetUtils)();
typedef void                 (*fp_RunCallbacks)();
typedef bool                 (*fp_IsCompleted)(ISteamUtils*, SteamAPICall_t, bool*);
typedef bool                 (*fp_GetResult)(ISteamUtils*, SteamAPICall_t, void*, int, int, bool*);

typedef bool            (*fp_FileWrite)(ISteamRemoteStorage*, const char*, const void*, int32_t);
typedef bool            (*fp_FileDelete)(ISteamRemoteStorage*, const char*);
typedef SteamAPICall_t  (*fp_FileShare)(ISteamRemoteStorage*, const char*);
typedef SteamAPICall_t  (*fp_Publish)(ISteamRemoteStorage*, const char*, const char*,
                                       uint32_t, const char*, const char*,
                                       int32_t, SteamParamStringArray_t*, int32_t);
typedef PublishedFileUpdateHandle_t (*fp_CreateUpdate)(ISteamRemoteStorage*, PublishedFileId_t);
typedef bool (*fp_UpdateFile)(ISteamRemoteStorage*, PublishedFileUpdateHandle_t, UGCHandle_t);
typedef bool (*fp_UpdatePreview)(ISteamRemoteStorage*, PublishedFileUpdateHandle_t, const char*);
typedef bool (*fp_UpdateTitle)(ISteamRemoteStorage*, PublishedFileUpdateHandle_t, const char*);
typedef bool (*fp_UpdateDesc)(ISteamRemoteStorage*, PublishedFileUpdateHandle_t, const char*);
typedef bool (*fp_UpdateVis)(ISteamRemoteStorage*, PublishedFileUpdateHandle_t, int32_t);
typedef bool (*fp_UpdateTags)(ISteamRemoteStorage*, PublishedFileUpdateHandle_t, SteamParamStringArray_t*);
typedef bool (*fp_UpdateChangeDesc)(ISteamRemoteStorage*, PublishedFileUpdateHandle_t, const char*);
typedef SteamAPICall_t (*fp_Commit)(ISteamRemoteStorage*, PublishedFileUpdateHandle_t, const char*);

// ── Static globals ─────────────────────────────────────────────────────────

static fp_GetRS           g_get_rs       = nullptr;
static fp_GetUtils        g_get_utils    = nullptr;
static fp_RunCallbacks    g_run_cbs      = nullptr;
static fp_IsCompleted     g_is_completed = nullptr;
static fp_GetResult       g_get_result   = nullptr;
static fp_FileWrite       g_file_write   = nullptr;
static fp_FileDelete      g_file_delete  = nullptr;
static fp_FileShare       g_file_share   = nullptr;
static fp_Publish         g_publish      = nullptr;
static fp_CreateUpdate    g_create_upd   = nullptr;
static fp_UpdateFile      g_upd_file     = nullptr;
static fp_UpdatePreview   g_upd_preview  = nullptr;
static fp_UpdateTitle     g_upd_title    = nullptr;
static fp_UpdateDesc      g_upd_desc     = nullptr;
static fp_UpdateVis       g_upd_vis      = nullptr;
static fp_UpdateTags      g_upd_tags     = nullptr;
static fp_UpdateChangeDesc g_upd_changedesc = nullptr;
static fp_Commit          g_commit       = nullptr;

static bool g_initialised = false;

// Helper: dlsym with logging
static void* resolve(void* lib, const char* sym, bool required) {
    void* fn = dlsym(lib, sym);
    if (!fn && required) {
        fprintf(stderr, "[coh2-workshop] MISSING symbol: %s\n", sym);
        fflush(stderr);
    }
    return fn;
}

bool steam_bridge_init() {
    if (g_initialised) return true;

    // libsteam_api.so is already loaded into this process by steamworks.js.
    // RTLD_DEFAULT searches all already-loaded libraries.
    void* lib = RTLD_DEFAULT;

    // Verify a known symbol is actually present
    if (!dlsym(lib, "SteamAPI_RunCallbacks")) {
        // Try to explicitly find it (it should already be mapped)
        lib = dlopen("libsteam_api.so", RTLD_NOLOAD | RTLD_NOW | RTLD_GLOBAL);
        if (!lib) {
            fprintf(stderr, "[coh2-workshop] libsteam_api.so not loaded in process — did steamworks.js init?\n");
            fflush(stderr);
            return false;
        }
    }

    g_get_rs       = (fp_GetRS)      resolve(lib, "SteamAPI_SteamRemoteStorage_v016", true);
    g_get_utils    = (fp_GetUtils)   resolve(lib, "SteamAPI_SteamUtils_v010",         true);
    g_run_cbs      = (fp_RunCallbacks)resolve(lib, "SteamAPI_RunCallbacks",            true);
    g_is_completed = (fp_IsCompleted) resolve(lib, "SteamAPI_ISteamUtils_IsAPICallCompleted", true);
    g_get_result   = (fp_GetResult)   resolve(lib, "SteamAPI_ISteamUtils_GetAPICallResult",   true);
    g_file_write   = (fp_FileWrite)   resolve(lib, "SteamAPI_ISteamRemoteStorage_FileWrite",  true);
    g_file_delete  = (fp_FileDelete)  resolve(lib, "SteamAPI_ISteamRemoteStorage_FileDelete", false);
    g_file_share   = (fp_FileShare)   resolve(lib, "SteamAPI_ISteamRemoteStorage_FileShare",  true);
    g_publish      = (fp_Publish)     resolve(lib, "SteamAPI_ISteamRemoteStorage_PublishWorkshopFile", true);
    g_create_upd   = (fp_CreateUpdate)resolve(lib, "SteamAPI_ISteamRemoteStorage_CreatePublishedFileUpdateRequest", true);
    g_upd_file     = (fp_UpdateFile)  resolve(lib, "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileFile",          true);
    g_upd_preview  = (fp_UpdatePreview)resolve(lib,"SteamAPI_ISteamRemoteStorage_UpdatePublishedFilePreviewFile",   false);
    g_upd_title    = (fp_UpdateTitle) resolve(lib, "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileTitle",         false);
    g_upd_desc     = (fp_UpdateDesc)  resolve(lib, "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileDescription",  false);
    g_upd_vis      = (fp_UpdateVis)   resolve(lib, "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileVisibility",    false);
    g_upd_tags     = (fp_UpdateTags)  resolve(lib, "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileTags",         false);
    g_upd_changedesc=(fp_UpdateChangeDesc)resolve(lib,"SteamAPI_ISteamRemoteStorage_UpdatePublishedFileSetChangeDescription", false);
    g_commit       = (fp_Commit)      resolve(lib, "SteamAPI_ISteamRemoteStorage_CommitPublishedFileUpdate",        true);

    bool ok = g_get_rs && g_get_utils && g_run_cbs && g_is_completed && g_get_result &&
              g_file_write && g_file_share && g_publish && g_create_upd &&
              g_upd_file && g_commit;

    if (ok) {
        g_initialised = true;
        fprintf(stderr, "[coh2-workshop] bridge init OK\n");
    } else {
        fprintf(stderr, "[coh2-workshop] bridge init FAILED — missing required symbols\n");
    }
    fflush(stderr);
    return ok;
}

ISteamRemoteStorage* steam_get_rs() {
    return g_get_rs ? g_get_rs() : nullptr;
}

ISteamUtils* steam_get_utils() {
    return g_get_utils ? g_get_utils() : nullptr;
}

void steam_run_callbacks() {
    if (g_run_cbs) g_run_cbs();
}

bool rs_FileWrite(ISteamRemoteStorage* rs, const char* file, const void* data, int32_t size) {
    return g_file_write ? g_file_write(rs, file, data, size) : false;
}

bool rs_FileDelete(ISteamRemoteStorage* rs, const char* file) {
    return g_file_delete ? g_file_delete(rs, file) : false;
}

SteamAPICall_t rs_FileShare(ISteamRemoteStorage* rs, const char* file) {
    return g_file_share ? g_file_share(rs, file) : 0;
}

SteamAPICall_t rs_PublishWorkshopFile(
    ISteamRemoteStorage* rs, const char* file, const char* preview,
    uint32_t appId, const char* title, const char* desc,
    int32_t vis, SteamParamStringArray_t* tags, int32_t fileType)
{
    return g_publish ? g_publish(rs, file, preview, appId, title, desc, vis, tags, fileType) : 0;
}

PublishedFileUpdateHandle_t rs_CreatePublishedFileUpdateRequest(
    ISteamRemoteStorage* rs, PublishedFileId_t id)
{
    return g_create_upd ? g_create_upd(rs, id) : k_UpdateHandleInvalid;
}

bool rs_UpdatePublishedFileFile(ISteamRemoteStorage* rs,
                                PublishedFileUpdateHandle_t h, UGCHandle_t ugc) {
    return g_upd_file ? g_upd_file(rs, h, ugc) : false;
}

bool rs_UpdatePublishedFilePreviewFile(ISteamRemoteStorage* rs,
                                       PublishedFileUpdateHandle_t h, const char* path) {
    return g_upd_preview ? g_upd_preview(rs, h, path) : false;
}

bool rs_UpdatePublishedFileTitle(ISteamRemoteStorage* rs,
                                 PublishedFileUpdateHandle_t h, const char* title) {
    return g_upd_title ? g_upd_title(rs, h, title) : false;
}

bool rs_UpdatePublishedFileDescription(ISteamRemoteStorage* rs,
                                       PublishedFileUpdateHandle_t h, const char* desc) {
    return g_upd_desc ? g_upd_desc(rs, h, desc) : false;
}

bool rs_UpdatePublishedFileVisibility(ISteamRemoteStorage* rs,
                                      PublishedFileUpdateHandle_t h, int32_t vis) {
    return g_upd_vis ? g_upd_vis(rs, h, vis) : false;
}

bool rs_UpdatePublishedFileTags(ISteamRemoteStorage* rs,
                                PublishedFileUpdateHandle_t h, SteamParamStringArray_t* tags) {
    return g_upd_tags ? g_upd_tags(rs, h, tags) : false;
}

bool rs_UpdatePublishedFileSetChangeDescription(ISteamRemoteStorage* rs,
                                                PublishedFileUpdateHandle_t h,
                                                const char* desc) {
    return g_upd_changedesc ? g_upd_changedesc(rs, h, desc) : false;
}

SteamAPICall_t rs_CommitPublishedFileUpdate(ISteamRemoteStorage* rs,
                                            PublishedFileUpdateHandle_t h,
                                            const char* changeDesc) {
    return g_commit ? g_commit(rs, h, changeDesc) : 0;
}

bool utils_IsAPICallCompleted(ISteamUtils* utils, SteamAPICall_t call, bool* failed) {
    return g_is_completed ? g_is_completed(utils, call, failed) : false;
}

bool utils_GetAPICallResult(ISteamUtils* utils, SteamAPICall_t call,
                             void* buf, int size, int cbId, bool* failed) {
    return g_get_result ? g_get_result(utils, call, buf, size, cbId, failed) : false;
}

const char* eresult_to_string(int32_t r) {
    switch (r) {
        case 1:  return "OK";
        case 2:  return "Fail";
        case 3:  return "NoConnection";
        case 5:  return "InvalidPassword";
        case 6:  return "LoggedInElsewhere";
        case 7:  return "InvalidProtocolVer";
        case 8:  return "InvalidParam";
        case 9:  return "FileNotFound";
        case 10: return "Busy";
        case 11: return "InvalidState";
        case 12: return "InvalidName";
        case 13: return "InvalidEmail";
        case 14: return "DuplicateName";
        case 15: return "AccessDenied";
        case 16: return "Timeout";
        case 17: return "Banned";
        case 18: return "AccountNotFound";
        case 19: return "InvalidSteamID";
        case 20: return "ServiceUnavailable";
        case 21: return "NotLoggedOn";
        case 22: return "Pending";
        case 23: return "EncryptionFailure";
        case 24: return "InsufficientPrivilege";
        case 25: return "LimitExceeded";
        case 26: return "Revoked";
        case 27: return "Expired";
        case 28: return "AlreadyRedeemed";
        case 29: return "DuplicateRequest";
        case 30: return "AlreadyOwned";
        case 31: return "IPNotFound";
        case 32: return "PersistFailed";
        case 33: return "LockingFailed";
        case 34: return "LogonSessionReplaced";
        case 35: return "ConnectFailed";
        case 36: return "HandshakeFailed";
        case 37: return "IOFailure";
        case 38: return "RemoteDisconnect";
        case 39: return "ShoppingCartNotFound";
        case 40: return "Blocked";
        case 41: return "Ignored";
        case 42: return "NoMatch";
        case 43: return "AccountDisabled";
        case 44: return "ServiceReadOnly";
        case 45: return "AccountNotFeatured";
        case 46: return "AdministratorOK";
        case 47: return "ContentVersion";
        case 48: return "TryAnotherCM";
        case 49: return "PasswordRequiredToKickSession";
        case 50: return "AlreadyLoggedInElsewhere";
        case 51: return "Suspended";
        case 52: return "Cancelled";
        case 53: return "DataCorruption";
        case 54: return "DiskFull";
        case 55: return "RemoteCallFailed";
        case 56: return "PasswordUnset";
        case 57: return "ExternalAccountUnlinked";
        case 58: return "PSNTicketInvalid";
        case 59: return "ExternalAccountAlreadyLinked";
        case 60: return "RemoteFileConflict";
        case 61: return "IllegalPassword";
        case 62: return "SameAsPreviousValue";
        case 63: return "AccountLogonDenied";
        case 64: return "CannotUseOldPassword";
        case 65: return "InvalidLoginAuthCode";
        case 66: return "AccountLogonDeniedNoMail";
        case 67: return "HardwareNotCapableOfIPT";
        case 68: return "IPTInitError";
        case 69: return "ParentalControlRestricted";
        case 70: return "FacebookQueryError";
        case 71: return "ExpiredLoginAuthCode";
        case 72: return "IPLoginRestrictionFailed";
        case 73: return "AccountLockedDown";
        case 74: return "AccountLogonDeniedVerifiedEmailRequired";
        case 75: return "NoMatchingURL";
        case 76: return "BadResponse";
        case 77: return "RequirePasswordReEntry";
        case 78: return "ValueOutOfRange";
        case 79: return "UnexpectedError";
        case 80: return "Disabled";
        case 81: return "InvalidCEGSubmission";
        case 82: return "RestrictedDevice";
        case 83: return "RegionLocked";
        case 84: return "RateLimitExceeded";
        case 85: return "AccountLoginDeniedNeedTwoFactor";
        case 86: return "ItemDeleted";
        case 87: return "AccountLoginDeniedThrottle";
        case 88: return "TwoFactorCodeMismatch";
        case 89: return "TwoFactorActivationCodeMismatch";
        case 90: return "AccountAssociatedToMultiplePartners";
        case 91: return "NotModified";
        case 92: return "NoMobileDevice";
        case 93: return "TimeNotSynced";
        case 94: return "SmsCodeFailed";
        case 95: return "AccountLimitExceeded";
        case 96: return "AccountActivityLimitExceeded";
        case 97: return "PhoneActivityLimitExceeded";
        case 98: return "RefundToWallet";
        case 99: return "EmailSendFailure";
        case 100: return "NotSettled";
        case 101: return "NeedCaptcha";
        case 102: return "GSLTDenied";
        case 103: return "GSOwnerDenied";
        case 104: return "InvalidItemType";
        case 105: return "IPBanned";
        case 106: return "GSLTExpired";
        default: { static char buf[32]; snprintf(buf, sizeof(buf), "EResult(%d)", r); return buf; }
    }
}
