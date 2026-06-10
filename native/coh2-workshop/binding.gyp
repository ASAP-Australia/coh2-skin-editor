{
  "targets": [
    {
      "target_name": "coh2_workshop",
      "sources": [
        "src/workshop_addon.cpp",
        "src/workshop_publish.cpp",
        "src/workshop_update.cpp",
        "src/workshop_delete.cpp",
        "src/callback_bridge.cpp",
        "src/steam_loop.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('../../node_modules/node-addon-api').include\")",
        "<!(node -p \"process.execPath.replace(/\\/bin\\/node$/, '').replace(/\\/bin\\/electron$/, '')\")/include/node",
        "<!@(node -p \"require('path').resolve(process.env.HOME + '/.cache/node-gyp/' + process.version.slice(1) + '/include/node')\")"
      ],
      "cflags_cc": [
        "-fexceptions",
        "-std=c++17",
        "-fvisibility=hidden"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NODE_ADDON_API_DISABLE_DEPRECATED"
      ],
      "libraries": [
        "-L<!(node -p \"require('path').resolve('../../node_modules/steamworks.js/dist/linux64')\")",
        "-l:libsteam_api.so",
        "-Wl,-rpath,<!(node -p \"require('path').resolve('../../node_modules/steamworks.js/dist/linux64')\")"
      ],
      "conditions": [
        ["OS=='linux'", {
          "ldflags": [
            "-Wl,-rpath,\\$$ORIGIN/../../../node_modules/steamworks.js/dist/linux64",
            "-Wl,-rpath,\\$$ORIGIN/../../../../node_modules/steamworks.js/dist/linux64",
            "-Wl,-rpath,\\$$ORIGIN/../../../../../node_modules/steamworks.js/dist/linux64"
          ]
        }]
      ]
    }
  ]
}
