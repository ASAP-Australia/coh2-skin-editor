#include "workshop_publish.h"
#include "callback_bridge.h"
#include <napi.h>
#include <uv.h>
#include <memory>
#include <string>
#include <vector>
#include <fstream>
#include <cstdio>
#include <cstring>
#include <cctype>
#include <functional>

// ── Helpers ────────────────────────────────────────────────────────────────

static std::string sanitize_cloud_name(const std::string& title) {
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

static bool read_file(const std::string& path, std::vector<char>& out, std::string& err) {
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

struct PublishContext {
    std::string sgaPath;
    std::string previewPath;
    uint32_t    appId;
    std::string title;
    std::string description;
    int32_t     visibility;
    std::vector<std::string> tags;
    std::string changeNote;

    // Output
    PublishedFileId_t publishedFileId = 0;
    bool              agreementNeeded = false;
};

// ── PollHandle ─────────────────────────────────────────────────────────────
// A heap-allocated uv_check handle that drives our state machine.

struct PollHandle {
    uv_check_t check;
    std::function<void()> on_complete;
    std::function<void()> on_timeout;
    std::function<bool()> is_done; // returns true when Steam call is done
    int ticks = 0;
    static constexpr int kMaxTicks = 6000; // 60s at 10ms check rate
};

static void start_poll(uv_loop_t* loop, PollHandle* ph) {
    uv_check_init(loop, &ph->check);
    ph->check.data = ph;
    uv_check_start(&ph->check, [](uv_check_t* h) {
        auto* ph = static_cast<PollHandle*>(h->data);
        ph->ticks++;
        if (ph->ticks > PollHandle::kMaxTicks) {
            uv_check_stop(h);
            uv_close((uv_handle_t*)h, [](uv_handle_t* hh) {
                delete static_cast<PollHandle*>(hh->data);
            });
            // on_timeout captured by value, safe to call after close schedules
            auto cb = ph->on_timeout;
            // Note: ph is deleted in the close callback above, but the
            // function objects were copied — safe.
            if (cb) cb();
            return;
        }
        if (ph->is_done()) {
            uv_check_stop(h);
            uv_close((uv_handle_t*)h, [](uv_handle_t* hh) {
                delete static_cast<PollHandle*>(hh->data);
            });
            auto cb = ph->on_complete;
            if (cb) cb();
        }
    });
}

// ── Async publish state machine ────────────────────────────────────────────
// Driven entirely from the Node.js main thread via uv_check callbacks.
// No background threads — Steam callbacks must run on the init thread.

class PublishWorker : public std::enable_shared_from_this<PublishWorker> {
public:
    enum class State { kFileShare, kPublish };

    PublishWorker(napi_env raw_env, std::shared_ptr<PublishContext> ctx)
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
    std::shared_ptr<PublishContext> ctx_;
    State state_;
    SteamAPICall_t pending_call_;
    std::string cloud_sga_path_;
    std::string cloud_preview_path_;

    void ResolveSuccess() {
        Napi::Env env(raw_env_);
        Napi::HandleScope scope(env);
        auto obj = Napi::Object::New(env);
        obj.Set("publishedFileId", Napi::BigInt::New(env, (uint64_t)ctx_->publishedFileId));
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
        if (!rs) { RejectError("[coh2-workshop:publish] ISteamRemoteStorage is null — Steam not initialised?"); return; }

        std::vector<char> sgaData;
        std::string readErr;
        if (!read_file(ctx_->sgaPath, sgaData, readErr)) {
            RejectError("[coh2-workshop:publish] " + readErr);
            return;
        }

        std::string safeName = sanitize_cloud_name(ctx_->title);
        cloud_sga_path_     = "mods/workshop/" + safeName + ".sga";
        cloud_preview_path_ = "mods/workshop/" + safeName + "_preview.png";

        fprintf(stderr, "[coh2-workshop:publish] FileWrite('%s', %zu bytes)\n",
                cloud_sga_path_.c_str(), sgaData.size());
        fflush(stderr);

        bool ok = rs_FileWrite(rs, cloud_sga_path_.c_str(), sgaData.data(), (int32_t)sgaData.size());
        if (!ok) {
            RejectError("[coh2-workshop:publish] FileWrite failed — Steam Cloud may be full or not logged in");
            return;
        }

        // Write preview to Steam Cloud (PublishWorkshopFile uses a cloud path for preview)
        std::vector<char> previewData;
        if (read_file(ctx_->previewPath, previewData, readErr)) {
            bool pok = rs_FileWrite(rs, cloud_preview_path_.c_str(),
                                    previewData.data(), (int32_t)previewData.size());
            fprintf(stderr, "[coh2-workshop:publish] Preview FileWrite: %s (%zu bytes)\n",
                    pok ? "OK" : "FAILED", previewData.size());
            fflush(stderr);
        }

        fprintf(stderr, "[coh2-workshop:publish] FileShare('%s')...\n", cloud_sga_path_.c_str());
        fflush(stderr);
        SteamAPICall_t call = rs_FileShare(rs, cloud_sga_path_.c_str());
        if (!call) {
            RejectError("[coh2-workshop:publish] FileShare returned null call handle");
            return;
        }
        pending_call_ = call;
        state_ = State::kFileShare;
        PollForResult();
    }

    void PollForResult() {
        ISteamUtils* utils = steam_get_utils();
        if (!utils) { RejectError("[coh2-workshop:publish] ISteamUtils is null"); return; }

        SteamAPICall_t call = pending_call_;
        auto self = shared_from_this();

        auto* ph = new PollHandle();
        ph->is_done = [utils, call]() -> bool {
            bool failed = false;
            return utils_IsAPICallCompleted(utils, call, &failed);
        };
        ph->on_complete = [self]() {
            self->OnCallCompleted();
        };
        ph->on_timeout = [self]() {
            self->RejectError("[coh2-workshop:publish] timeout waiting for Steam API call");
        };

        start_poll(uv_default_loop(), ph);
    }

    void OnCallCompleted() {
        ISteamUtils* utils = steam_get_utils();
        if (!utils) { RejectError("[coh2-workshop:publish] ISteamUtils null on completion"); return; }

        if (state_ == State::kFileShare) {
            RemoteStorageFileShareResult_t res{};
            bool pbFailed = false;
            bool ok = utils_GetAPICallResult(utils, pending_call_,
                                             &res, (int)sizeof(res),
                                             k_iCallback_FileShareResult, &pbFailed);
            fprintf(stderr, "[coh2-workshop:publish] FileShare result: ok=%d eResult=%d(%s) hFile=%llu\n",
                    (int)ok, res.m_eResult, eresult_to_string(res.m_eResult),
                    (unsigned long long)res.m_hFile);
            fflush(stderr);

            if (!ok || pbFailed || res.m_eResult != 1) {
                RejectError(std::string("[coh2-workshop:publish] FileShare failed: ") + eresult_to_string(res.m_eResult));
                return;
            }
            DoPublishStep(res.m_hFile);

        } else if (state_ == State::kPublish) {
            RemoteStoragePublishFileResult_t res{};
            bool pbFailed = false;
            bool ok = utils_GetAPICallResult(utils, pending_call_,
                                             &res, (int)sizeof(res),
                                             k_iCallback_PublishResult, &pbFailed);
            fprintf(stderr, "[coh2-workshop:publish] PublishWorkshopFile result: ok=%d eResult=%d(%s) fileId=%llu agreement=%d\n",
                    (int)ok, res.m_eResult, eresult_to_string(res.m_eResult),
                    (unsigned long long)res.m_nPublishedFileId,
                    (int)res.m_bUserNeedsToAcceptWorkshopLegalAgreement);
            fflush(stderr);

            if (!ok || pbFailed || res.m_eResult != 1) {
                RejectError(std::string("[coh2-workshop:publish] PublishWorkshopFile failed: ") + eresult_to_string(res.m_eResult));
                return;
            }
            ctx_->publishedFileId = res.m_nPublishedFileId;
            ctx_->agreementNeeded = res.m_bUserNeedsToAcceptWorkshopLegalAgreement;
            ResolveSuccess();
        }
    }

    void DoPublishStep(UGCHandle_t /*ugcHandle*/) {
        std::vector<const char*> tagPtrs;
        for (auto& t : ctx_->tags) tagPtrs.push_back(t.c_str());
        SteamParamStringArray_t tagsArr{
            tagPtrs.empty() ? nullptr : tagPtrs.data(),
            (int32_t)tagPtrs.size()
        };

        ISteamRemoteStorage* rs = steam_get_rs();
        fprintf(stderr, "[coh2-workshop:publish] PublishWorkshopFile('%s', preview='%s', title='%s', vis=%d, tags=%d)...\n",
                cloud_sga_path_.c_str(), cloud_preview_path_.c_str(),
                ctx_->title.c_str(), (int)ctx_->visibility, (int)tagPtrs.size());
        fflush(stderr);

        SteamAPICall_t call = rs_PublishWorkshopFile(
            rs,
            cloud_sga_path_.c_str(),
            cloud_preview_path_.c_str(),
            ctx_->appId,
            ctx_->title.c_str(),
            ctx_->description.c_str(),
            ctx_->visibility,
            &tagsArr,
            0 /* k_EWorkshopFileTypeCommunity */
        );

        if (!call) {
            RejectError("[coh2-workshop:publish] PublishWorkshopFile returned null call handle");
            return;
        }
        pending_call_ = call;
        state_ = State::kPublish;
        PollForResult();
    }
};

// ── N-API entry point ──────────────────────────────────────────────────────

Napi::Value publishNewItem(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        throw Napi::TypeError::New(env, "publishNewItem: expected object argument");
    }

    auto obj = info[0].As<Napi::Object>();
    auto ctx = std::make_shared<PublishContext>();

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
        : "Initial upload";

    fprintf(stderr, "[coh2-workshop:publish] publishNewItem called: title=%s appId=%u sgaPath=%s\n",
            ctx->title.c_str(), ctx->appId, ctx->sgaPath.c_str());
    fflush(stderr);

    // The worker is kept alive by the shared_ptr captured in the uv_check callbacks.
    auto worker = std::make_shared<PublishWorker>((napi_env)env, ctx);
    return worker->Start();
}
