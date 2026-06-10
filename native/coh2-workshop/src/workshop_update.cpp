#include "workshop_update.h"
#include "callback_bridge.h"
#include <napi.h>
#include <uv.h>
#include <memory>
#include <string>
#include <vector>
#include <fstream>
#include <cstdio>
#include <cctype>
#include <cstring>
#include <functional>

// ── Helpers ────────────────────────────────────────────────────────────────

static std::string sanitize_cloud_name_u(const std::string& title) {
    std::string out;
    out.reserve(title.size());
    for (char c : title) {
        if (std::isalnum((unsigned char)c) || c == ' ' || c == '-' || c == '_') {
            out += c;
        } else {
            out += '_';
        }
    }
    if (out.size() > 64) out.resize(64);
    for (char& c : out) if (c == ' ') c = '_';
    if (out.empty()) out = "workshop_item";
    return out;
}

static bool read_file_u(const std::string& path, std::vector<char>& out, std::string& err) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) { err = "cannot open file: " + path; return false; }
    auto size = f.tellg();
    if (size <= 0) { err = "empty file: " + path; return false; }
    f.seekg(0);
    out.resize(static_cast<size_t>(size));
    f.read(out.data(), size);
    if (!f) { err = "read error: " + path; return false; }
    return true;
}

// ── Context ────────────────────────────────────────────────────────────────

struct UpdateContext {
    PublishedFileId_t publishedFileId;
    std::string sgaPath;
    std::string previewPath;
    uint32_t    appId;
    std::string title;
    std::string description;
    int32_t     visibility;
    std::vector<std::string> tags;
    std::string changeNote;

    PublishedFileId_t outPublishedFileId = 0;
    bool              agreementNeeded    = false;
};

// ── PollHandle ────────────────────────────────────────────────────────────

struct PollHandleU {
    uv_check_t check;
    std::function<void()> on_complete;
    std::function<void()> on_timeout;
    std::function<bool()> is_done;
    int ticks = 0;
    static constexpr int kMaxTicks = 6000;
};

static void start_poll_u(uv_loop_t* loop, PollHandleU* ph) {
    uv_check_init(loop, &ph->check);
    ph->check.data = ph;
    uv_check_start(&ph->check, [](uv_check_t* h) {
        auto* ph = static_cast<PollHandleU*>(h->data);
        ph->ticks++;
        if (ph->ticks > PollHandleU::kMaxTicks) {
            uv_check_stop(h);
            uv_close((uv_handle_t*)h, [](uv_handle_t* hh) {
                delete static_cast<PollHandleU*>(hh->data);
            });
            auto cb = ph->on_timeout;
            if (cb) {
                try { cb(); }
                catch (const Napi::Error&) { /* exception already pending in env; do not rethrow */ }
                catch (...) { /* last-resort swallow — prevents std::terminate across the C boundary */ }
            }
            return;
        }
        if (ph->is_done()) {
            uv_check_stop(h);
            uv_close((uv_handle_t*)h, [](uv_handle_t* hh) {
                delete static_cast<PollHandleU*>(hh->data);
            });
            auto cb = ph->on_complete;
            if (cb) {
                try { cb(); }
                catch (const Napi::Error&) { /* exception already pending in env; do not rethrow */ }
                catch (...) { /* last-resort swallow — prevents std::terminate across the C boundary */ }
            }
        }
    });
}

// ── Async update state machine ─────────────────────────────────────────────

class UpdateWorker : public std::enable_shared_from_this<UpdateWorker> {
public:
    enum class State { kFileShare, kCommit };

    UpdateWorker(napi_env raw_env, std::shared_ptr<UpdateContext> ctx)
        : raw_env_(raw_env)
        , deferred_(Napi::Promise::Deferred::New(Napi::Env(raw_env)))
        , ctx_(std::move(ctx))
        , state_(State::kFileShare)
        , pending_call_(0)
    {}

    Napi::Promise Start() {
        auto promise = deferred_.Promise();
        DoFileShareStep();
        return promise;
    }

private:
    napi_env raw_env_;
    Napi::Promise::Deferred deferred_;
    std::shared_ptr<UpdateContext> ctx_;
    State state_;
    SteamAPICall_t pending_call_;
    std::string cloud_sga_path_;
    int fileShareAttempts_ = 0;
    // The cloud upload that backs FileShare is asynchronous; FileShare returns
    // FileNotFound (9) until Steam has pushed the file to its servers. Retry
    // patiently (~30s) to ride out the upload rather than giving up at ~5s.
    static constexpr int kMaxFileShareAttempts = 20;

    void ResolveSuccess() {
        Napi::Env env(raw_env_);
        Napi::HandleScope scope(env);
        auto obj = Napi::Object::New(env);
        obj.Set("publishedFileId", Napi::BigInt::New(env, (uint64_t)ctx_->outPublishedFileId));
        obj.Set("agreementNeeded", Napi::Boolean::New(env, ctx_->agreementNeeded));
        deferred_.Resolve(obj);
    }

    void RejectError(const std::string& msg) {
        Napi::Env env(raw_env_);
        Napi::HandleScope scope(env);
        deferred_.Reject(Napi::Error::New(env, msg).Value());
    }

    void DoFileShareStep() {
        ISteamRemoteStorage* rs = steam_get_rs();
        if (!rs) { RejectError("[coh2-workshop:update] ISteamRemoteStorage is null"); return; }

        // Root-cause probe: FileShare returns FileNotFound (9) when the file is
        // written to the local cloud folder but never uploaded to Steam's
        // servers — which happens when Cloud is disabled for the app. Read the
        // cloud-enable state + quota, and force-enable app cloud if it's off.
        bool     cloudApp  = rs_IsCloudEnabledForApp(rs);
        bool     cloudAcct = rs_IsCloudEnabledForAccount(rs);
        uint64_t qTotal = 0, qAvail = 0;
        bool     quotaOk = rs_GetQuota(rs, &qTotal, &qAvail);
        fprintf(stderr, "[coh2-workshop:update] cloud: app=%d acct=%d quota(ok=%d total=%llu avail=%llu)\n",
                (int)cloudApp, (int)cloudAcct, (int)quotaOk,
                (unsigned long long)qTotal, (unsigned long long)qAvail);
        fflush(stderr);
        if (!cloudApp) {
            fprintf(stderr, "[coh2-workshop:update] Cloud disabled for app — calling SetCloudEnabledForApp(true)\n");
            fflush(stderr);
            rs_SetCloudEnabledForApp(rs, true);
        }

        std::vector<char> sgaData;
        std::string err;
        if (!read_file_u(ctx_->sgaPath, sgaData, err)) {
            RejectError("[coh2-workshop:update] " + err);
            return;
        }

        std::string safeName = sanitize_cloud_name_u(ctx_->title);
        cloud_sga_path_ = "mods/workshop/" + safeName + ".sga";

        // NOTE: We intentionally do NOT FileDelete the prior cloud copy first.
        // Deleting wipes the server-side file and forces a fresh upload, which
        // the subsequent FileShare then races (returning FileNotFound). By
        // overwriting in place with FileWrite + SetSyncPlatforms, an already
        // uploaded copy can be shared immediately and changed bytes upload as a
        // normal update.

        fprintf(stderr, "[coh2-workshop:update] FileWrite('%s', %zu bytes)\n",
                cloud_sga_path_.c_str(), sgaData.size());
        fflush(stderr);

        bool ok = rs_FileWrite(rs, cloud_sga_path_.c_str(), sgaData.data(), (int32_t)sgaData.size());
        if (!ok) {
            RejectError("[coh2-workshop:update] FileWrite failed for SGA");
            return;
        }

        // Force the file to sync to all platforms so Steam uploads it to the
        // cloud servers (k_ERemoteStoragePlatformAll = -1). FileShare shares the
        // server-side copy, so the file must be flagged for upload.
        bool syncOk = rs_SetSyncPlatforms(rs, cloud_sga_path_.c_str(), -1);
        fprintf(stderr, "[coh2-workshop:update] SetSyncPlatforms(All): %s\n",
                syncOk ? "OK" : "FAILED/absent");
        fflush(stderr);

        // Wait for Steam to persist the freshly-written cloud file before
        // sharing it. FileShare returns FileNotFound (9) when it runs before
        // the local write has been committed/synced to Steam Cloud — the root
        // cause of the intermittent "FileShare failed: file not found" error.
        WaitForPersistThenShare();
    }

    // Poll until the just-written cloud file is persisted (or a short budget
    // elapses), then issue FileShare. Degrades to "share immediately" when the
    // FilePersisted symbol is unavailable (rs_FilePersisted returns true).
    void WaitForPersistThenShare() {
        ISteamRemoteStorage* rs = steam_get_rs();
        auto self = shared_from_this();
        std::string path = cloud_sga_path_;
        auto* ph = new PollHandleU();
        ph->is_done = [ph, rs, path]() -> bool {
            return rs_FilePersisted(rs, path.c_str()) || ph->ticks >= 300; // ~3s cap
        };
        ph->on_complete = [self]() { self->IssueFileShare(); };
        ph->on_timeout  = [self]() { self->IssueFileShare(); };
        start_poll_u(uv_default_loop(), ph);
    }

    // Simple tick delay, then run cb (used to space out FileShare retries).
    void DelayThen(int ticks, std::function<void()> cb) {
        auto* ph = new PollHandleU();
        ph->is_done     = [ph, ticks]() -> bool { return ph->ticks >= ticks; };
        ph->on_complete = cb;
        ph->on_timeout  = cb;
        start_poll_u(uv_default_loop(), ph);
    }

    void IssueFileShare() {
        ISteamRemoteStorage* rs = steam_get_rs();
        if (!rs) { RejectError("[coh2-workshop:update] ISteamRemoteStorage is null"); return; }

        bool    exists    = rs_FileExists(rs, cloud_sga_path_.c_str());
        int32_t sz        = rs_GetFileSize(rs, cloud_sga_path_.c_str());
        bool    persisted = rs_FilePersisted(rs, cloud_sga_path_.c_str());
        fprintf(stderr, "[coh2-workshop:update] FileShare('%s') attempt %d/%d exists=%d size=%d persisted=%d\n",
                cloud_sga_path_.c_str(), fileShareAttempts_ + 1, kMaxFileShareAttempts,
                (int)exists, sz, (int)persisted);
        fflush(stderr);

        SteamAPICall_t call = rs_FileShare(rs, cloud_sga_path_.c_str());
        if (!call) {
            RejectError("[coh2-workshop:update] FileShare returned null call handle");
            return;
        }
        fileShareAttempts_++;
        pending_call_ = call;
        state_ = State::kFileShare;
        PollForResult();
    }

    void PollForResult() {
        ISteamUtils* utils = steam_get_utils();
        if (!utils) { RejectError("[coh2-workshop:update] ISteamUtils is null"); return; }

        SteamAPICall_t call = pending_call_;
        auto self = shared_from_this();

        auto* ph = new PollHandleU();
        ph->is_done = [utils, call]() -> bool {
            bool failed = false;
            return utils_IsAPICallCompleted(utils, call, &failed);
        };
        ph->on_complete = [self]() { self->OnCallCompleted(); };
        ph->on_timeout  = [self]() {
            self->RejectError("[coh2-workshop:update] timeout waiting for Steam API call");
        };

        start_poll_u(uv_default_loop(), ph);
    }

    void OnCallCompleted() {
        ISteamUtils* utils = steam_get_utils();
        if (!utils) { RejectError("[coh2-workshop:update] ISteamUtils null on completion"); return; }

        if (state_ == State::kFileShare) {
            RemoteStorageFileShareResult_t res{};
            bool pbFailed = false;
            bool ok = utils_GetAPICallResult(utils, pending_call_,
                                             &res, (int)sizeof(res),
                                             k_iCallback_FileShareResult, &pbFailed);
            fprintf(stderr, "[coh2-workshop:update] FileShare result: ok=%d eResult=%d(%s) hFile=%llu\n",
                    (int)ok, res.m_eResult, eresult_to_string(res.m_eResult),
                    (unsigned long long)res.m_hFile);
            fflush(stderr);

            if (!ok || pbFailed || res.m_eResult != 1) {
                // eResult 9 = FileNotFound: the cloud file wasn't ready to share
                // yet. Wait briefly and retry the share before giving up.
                if (res.m_eResult == 9 && fileShareAttempts_ < kMaxFileShareAttempts) {
                    fprintf(stderr, "[coh2-workshop:update] FileShare FileNotFound — retrying after delay (next attempt %d/%d)\n",
                            fileShareAttempts_ + 1, kMaxFileShareAttempts);
                    fflush(stderr);
                    auto self = shared_from_this();
                    DelayThen(120, [self]() { self->WaitForPersistThenShare(); }); // ~1.2s
                    return;
                }
                RejectError(std::string("[coh2-workshop:update] FileShare failed: ") + eresult_to_string(res.m_eResult));
                return;
            }
            DoUpdateStep(res.m_hFile);

        } else if (state_ == State::kCommit) {
            RemoteStorageUpdatePublishedFileResult_t res{};
            bool pbFailed = false;
            bool ok = utils_GetAPICallResult(utils, pending_call_,
                                             &res, (int)sizeof(res),
                                             k_iCallback_UpdateResult, &pbFailed);
            fprintf(stderr, "[coh2-workshop:update] Commit result: ok=%d eResult=%d(%s) fileId=%llu agreement=%d\n",
                    (int)ok, res.m_eResult, eresult_to_string(res.m_eResult),
                    (unsigned long long)res.m_nPublishedFileId,
                    (int)res.m_bUserNeedsToAcceptWorkshopLegalAgreement);
            fflush(stderr);

            if (!ok || pbFailed || res.m_eResult != 1) {
                RejectError(std::string("[coh2-workshop:update] CommitPublishedFileUpdate failed: ") + eresult_to_string(res.m_eResult));
                return;
            }
            ctx_->outPublishedFileId = res.m_nPublishedFileId
                ? res.m_nPublishedFileId
                : ctx_->publishedFileId;
            ctx_->agreementNeeded = res.m_bUserNeedsToAcceptWorkshopLegalAgreement;
            ResolveSuccess();
        }
    }

    void DoUpdateStep(UGCHandle_t ugcHandle) {
        ISteamRemoteStorage* rs = steam_get_rs();

        fprintf(stderr, "[coh2-workshop:update] CreatePublishedFileUpdateRequest(%llu)\n",
                (unsigned long long)ctx_->publishedFileId);
        fflush(stderr);

        PublishedFileUpdateHandle_t upd =
            rs_CreatePublishedFileUpdateRequest(rs, ctx_->publishedFileId);
        if (upd == k_UpdateHandleInvalid) {
            RejectError("[coh2-workshop:update] CreatePublishedFileUpdateRequest returned invalid handle");
            return;
        }

        bool fileOk = rs_UpdatePublishedFileFile(rs, upd, ugcHandle);
        fprintf(stderr, "[coh2-workshop:update] UpdatePublishedFileFile(ugc=%llu): %s\n",
                (unsigned long long)ugcHandle, fileOk ? "OK" : "FAILED");

        if (!ctx_->previewPath.empty()) {
            bool prevOk = rs_UpdatePublishedFilePreviewFile(rs, upd, ctx_->previewPath.c_str());
            fprintf(stderr, "[coh2-workshop:update] UpdatePublishedFilePreviewFile: %s\n", prevOk ? "OK" : "FAILED");
        }

        rs_UpdatePublishedFileTitle(rs, upd, ctx_->title.c_str());
        rs_UpdatePublishedFileDescription(rs, upd, ctx_->description.c_str());
        rs_UpdatePublishedFileVisibility(rs, upd, ctx_->visibility);

        std::vector<const char*> tagPtrs;
        for (auto& t : ctx_->tags) tagPtrs.push_back(t.c_str());
        SteamParamStringArray_t tagsArr{
            tagPtrs.empty() ? nullptr : tagPtrs.data(),
            (int32_t)tagPtrs.size()
        };
        rs_UpdatePublishedFileTags(rs, upd, &tagsArr);
        rs_UpdatePublishedFileSetChangeDescription(rs, upd, ctx_->changeNote.c_str());

        fprintf(stderr, "[coh2-workshop:update] CommitPublishedFileUpdate...\n");
        fflush(stderr);

        SteamAPICall_t call = rs_CommitPublishedFileUpdate(rs, upd, ctx_->changeNote.c_str());
        if (!call) {
            RejectError("[coh2-workshop:update] CommitPublishedFileUpdate returned null call handle");
            return;
        }
        pending_call_ = call;
        state_ = State::kCommit;
        PollForResult();
    }
};

// ── N-API entry point ──────────────────────────────────────────────────────

Napi::Value updateExistingItem(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        throw Napi::TypeError::New(env, "updateExistingItem: expected object argument");
    }

    auto obj = info[0].As<Napi::Object>();
    auto ctx = std::make_shared<UpdateContext>();

    auto fileIdVal = obj.Get("publishedFileId");
    if (!fileIdVal.IsBigInt()) {
        throw Napi::TypeError::New(env, "updateExistingItem: publishedFileId must be a BigInt");
    }
    bool lossless = true;
    ctx->publishedFileId = fileIdVal.As<Napi::BigInt>().Uint64Value(&lossless);

    ctx->sgaPath      = obj.Get("sgaPath").As<Napi::String>().Utf8Value();
    ctx->previewPath  = obj.Get("previewPath").As<Napi::String>().Utf8Value();
    ctx->appId        = (uint32_t)obj.Get("appId").As<Napi::Number>().Uint32Value();
    ctx->title        = obj.Get("title").As<Napi::String>().Utf8Value();
    ctx->description  = obj.Get("description").As<Napi::String>().Utf8Value();
    ctx->visibility   = obj.Get("visibility").As<Napi::Number>().Int32Value();

    auto tagsVal = obj.Get("tags");
    if (tagsVal.IsArray()) {
        auto tagsArr = tagsVal.As<Napi::Array>();
        for (uint32_t i = 0; i < tagsArr.Length(); i++) {
            ctx->tags.push_back(tagsArr.Get(i).As<Napi::String>().Utf8Value());
        }
    }

    auto changeNoteVal = obj.Get("changeNote");
    ctx->changeNote = changeNoteVal.IsString()
        ? changeNoteVal.As<Napi::String>().Utf8Value()
        : "Update";

    fprintf(stderr, "[coh2-workshop:update] updateExistingItem called: fileId=%llu title=%s\n",
            (unsigned long long)ctx->publishedFileId, ctx->title.c_str());
    fflush(stderr);

    auto worker = std::make_shared<UpdateWorker>((napi_env)env, ctx);
    return worker->Start();
}
