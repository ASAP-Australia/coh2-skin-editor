#include <napi.h>
#include <uv.h>
#include "callback_bridge.h"
#include "steam_loop.h"
#include "workshop_publish.h"
#include "workshop_update.h"
#include "workshop_delete.h"
#include <cstdio>

// ── startCallbackPump ──────────────────────────────────────────────────────

static Napi::Value jsStartCallbackPump(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Lazily init the bridge (resolves flat API function pointers)
    if (!steam_bridge_init()) {
        throw Napi::Error::New(env,
            "[coh2-workshop] startCallbackPump: steam_bridge_init failed — "
            "is steamworks.js initialised before calling startCallbackPump?");
    }

    steam_loop_start(uv_default_loop());
    return env.Undefined();
}

// ── stopCallbackPump ───────────────────────────────────────────────────────

static Napi::Value jsStopCallbackPump(const Napi::CallbackInfo& info) {
    steam_loop_stop();
    return info.Env().Undefined();
}

// ── publishNewItem wrapper (also inits bridge) ────────────────────────────

static Napi::Value jsPublishNewItem(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!steam_bridge_init()) {
        throw Napi::Error::New(env,
            "[coh2-workshop] publishNewItem: steam_bridge_init failed — "
            "ensure steamworks.js is initialised first");
    }
    return publishNewItem(info);
}

// ── updateExistingItem wrapper (also inits bridge) ────────────────────────

static Napi::Value jsUpdateExistingItem(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!steam_bridge_init()) {
        throw Napi::Error::New(env,
            "[coh2-workshop] updateExistingItem: steam_bridge_init failed — "
            "ensure steamworks.js is initialised first");
    }
    return updateExistingItem(info);
}

// ── deletePublishedItem wrapper (also inits bridge) ───────────────────────

static Napi::Value jsDeletePublishedItemWrapper(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!steam_bridge_init()) {
        throw Napi::Error::New(env,
            "[coh2-workshop] deletePublishedItem: steam_bridge_init failed — "
            "ensure steamworks.js is initialised first");
    }
    return jsDeletePublishedItem(info);
}

// ── Module init ────────────────────────────────────────────────────────────

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    fprintf(stderr, "[coh2-workshop] addon loaded\n");
    fflush(stderr);

    exports.Set("publishNewItem",      Napi::Function::New(env, jsPublishNewItem));
    exports.Set("updateExistingItem",  Napi::Function::New(env, jsUpdateExistingItem));
    exports.Set("deletePublishedItem", Napi::Function::New(env, jsDeletePublishedItemWrapper));
    exports.Set("startCallbackPump",   Napi::Function::New(env, jsStartCallbackPump));
    exports.Set("stopCallbackPump",    Napi::Function::New(env, jsStopCallbackPump));

    return exports;
}

NODE_API_MODULE(coh2_workshop, Init)
