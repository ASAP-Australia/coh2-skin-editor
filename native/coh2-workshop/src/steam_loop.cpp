#include "steam_loop.h"
#include "callback_bridge.h"
#include <uv.h>
#include <atomic>
#include <cstdio>

static uv_timer_t s_timer;
static std::atomic<bool> s_running{false};

static void on_timer(uv_timer_t* /*handle*/) {
    steam_run_callbacks();
}

void steam_loop_start(void* uv_loop_ptr) {
    if (s_running.exchange(true)) {
        return; // Already running — idempotent
    }
    uv_loop_t* loop = static_cast<uv_loop_t*>(uv_loop_ptr);
    uv_timer_init(loop, &s_timer);
    uv_timer_start(&s_timer, on_timer, 0, 100);
    fprintf(stderr, "[coh2-workshop] callback pump started (100 ms interval)\n");
    fflush(stderr);
}

void steam_loop_stop() {
    if (!s_running.exchange(false)) {
        return;
    }
    uv_timer_stop(&s_timer);
    fprintf(stderr, "[coh2-workshop] callback pump stopped\n");
    fflush(stderr);
}
