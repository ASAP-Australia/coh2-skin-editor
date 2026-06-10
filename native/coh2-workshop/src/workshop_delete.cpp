#include "workshop_delete.h"
#include "callback_bridge.h"
#include <napi.h>
#include <uv.h>
#include <memory>
#include <string>
#include <functional>
#include <cstdio>

// ── PollHandle ─────────────────────────────────────────────────────────────
// Re-declares the same PollHandle pattern used by PublishWorker.
// (Cannot share a header since workshop_publish.cpp defines it locally;
//  we declare an identical struct here so this TU is self-contained.)

struct DeletePollHandle {
    uv_check_t check;
    std::function<void()> on_complete;
    std::function<void()> on_timeout;
    std::function<bool()> is_done;
    int ticks = 0;
    static constexpr int kMaxTicks = 6000; // 60s at 10ms check rate
};

static void start_delete_poll(uv_loop_t* loop, DeletePollHandle* ph) {
    uv_check_init(loop, &ph->check);
    ph->check.data = ph;
    uv_check_start(&ph->check, [](uv_check_t* h) {
        auto* ph = static_cast<DeletePollHandle*>(h->data);
        ph->ticks++;
        if (ph->ticks > DeletePollHandle::kMaxTicks) {
            uv_check_stop(h);
            uv_close((uv_handle_t*)h, [](uv_handle_t* hh) {
                delete static_cast<DeletePollHandle*>(hh->data);
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
                delete static_cast<DeletePollHandle*>(hh->data);
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

// ── DeleteWorker ───────────────────────────────────────────────────────────

class DeleteWorker : public std::enable_shared_from_this<DeleteWorker> {
public:
    DeleteWorker(napi_env raw_env, PublishedFileId_t fileId)
        : raw_env_(raw_env)
        , deferred_(Napi::Promise::Deferred::New(Napi::Env(raw_env)))
        , fileId_(fileId)
        , pending_call_(0)
    {}

    Napi::Promise Start() {
        auto promise = deferred_.Promise();
        DoDeleteStep();
        return promise;
    }

private:
    napi_env raw_env_;
    Napi::Promise::Deferred deferred_;
    PublishedFileId_t fileId_;
    SteamAPICall_t pending_call_;

    void ResolveSuccess() {
        Napi::Env env(raw_env_);
        Napi::HandleScope scope(env);
        auto obj = Napi::Object::New(env);
        obj.Set("publishedFileId", Napi::BigInt::New(env, (uint64_t)fileId_));
        deferred_.Resolve(obj);
    }

    void RejectError(const std::string& msg) {
        Napi::Env env(raw_env_);
        Napi::HandleScope scope(env);
        deferred_.Reject(Napi::Error::New(env, msg).Value());
    }

    void DoDeleteStep() {
        ISteamRemoteStorage* rs = steam_get_rs();
        if (!rs) {
            RejectError("[coh2-workshop:delete] ISteamRemoteStorage is null — Steam not initialised?");
            return;
        }

        fprintf(stderr, "[coh2-workshop:delete] DeletePublishedFile(fileId=%llu)...\n",
                (unsigned long long)fileId_);
        fflush(stderr);

        SteamAPICall_t call = rs_DeletePublishedFile(rs, fileId_);
        if (!call) {
            RejectError("[coh2-workshop:delete] DeletePublishedFile returned null call handle");
            return;
        }
        pending_call_ = call;
        PollForResult();
    }

    void PollForResult() {
        ISteamUtils* utils = steam_get_utils();
        if (!utils) { RejectError("[coh2-workshop:delete] ISteamUtils is null"); return; }

        SteamAPICall_t call = pending_call_;
        auto self = shared_from_this();

        auto* ph = new DeletePollHandle();
        ph->is_done = [utils, call]() -> bool {
            bool failed = false;
            return utils_IsAPICallCompleted(utils, call, &failed);
        };
        ph->on_complete = [self]() {
            self->OnCallCompleted();
        };
        ph->on_timeout = [self]() {
            self->RejectError("[coh2-workshop:delete] timeout waiting for Steam API call");
        };

        start_delete_poll(uv_default_loop(), ph);
    }

    void OnCallCompleted() {
        ISteamUtils* utils = steam_get_utils();
        if (!utils) { RejectError("[coh2-workshop:delete] ISteamUtils null on completion"); return; }

        RemoteStorageDeletePublishedFileResult_t res{};
        bool pbFailed = false;
        bool ok = utils_GetAPICallResult(utils, pending_call_,
                                         &res, (int)sizeof(res),
                                         k_iCallback_DeletePublishedFileResult, &pbFailed);

        fprintf(stderr, "[coh2-workshop:delete] DeletePublishedFile result: ok=%d eResult=%d(%s) fileId=%llu\n",
                (int)ok, res.m_eResult, eresult_to_string(res.m_eResult),
                (unsigned long long)res.m_nPublishedFileId);
        fflush(stderr);

        if (!ok || pbFailed || res.m_eResult != 1) {
            RejectError(std::string("[coh2-workshop:delete] DeletePublishedFile failed: ") +
                        eresult_to_string(res.m_eResult) +
                        " (eResult=" + std::to_string(res.m_eResult) + ")");
            return;
        }

        ResolveSuccess();
    }
};

// ── N-API entry point ──────────────────────────────────────────────────────

Napi::Value jsDeletePublishedItem(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        throw Napi::TypeError::New(env, "jsDeletePublishedItem: expected BigInt argument");
    }

    PublishedFileId_t fileId = 0;
    if (info[0].IsBigInt()) {
        bool lossless = false;
        fileId = (PublishedFileId_t)info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    } else if (info[0].IsString()) {
        std::string s = info[0].As<Napi::String>().Utf8Value();
        try {
            fileId = (PublishedFileId_t)std::stoull(s);
        } catch (...) {
            throw Napi::TypeError::New(env, "jsDeletePublishedItem: string argument is not a valid uint64");
        }
    } else if (info[0].IsNumber()) {
        fileId = (PublishedFileId_t)(uint64_t)info[0].As<Napi::Number>().DoubleValue();
    } else {
        throw Napi::TypeError::New(env, "jsDeletePublishedItem: expected BigInt, string, or number argument");
    }

    fprintf(stderr, "[coh2-workshop:delete] jsDeletePublishedItem called: fileId=%llu\n",
            (unsigned long long)fileId);
    fflush(stderr);

    // The worker is kept alive by the shared_ptr captured in the uv_check callbacks.
    auto worker = std::make_shared<DeleteWorker>((napi_env)env, fileId);
    return worker->Start();
}
