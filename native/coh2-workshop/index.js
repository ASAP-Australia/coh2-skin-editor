'use strict'

const path = require('path')
const { versions, arch, platform } = process

// Electron exposes process.versions.modules for the ABI version
// Node exposes process.versions.modules too — use it.
const abi = versions.modules
const platformArch = `${platform === 'win32' ? 'win' : platform === 'darwin' ? 'darwin' : 'linux'}-${arch}-${abi}`

// electron-rebuild places the binary at bin/<platform>-<arch>-<abi>/<name>.node
const prebuiltPath = path.join(__dirname, 'bin', platformArch, 'coh2-workshop.node')

let binding
try {
  binding = require(prebuiltPath)
} catch (e1) {
  // Fallback to plain node-gyp build path
  const devPath = path.join(__dirname, 'build', 'Release', 'coh2_workshop.node')
  try {
    binding = require(devPath)
  } catch (e2) {
    throw new Error(
      `[coh2-workshop] Could not load native addon.\n` +
      `  Tried: ${prebuiltPath}\n` +
      `  Tried: ${devPath}\n` +
      `  Error 1: ${e1.message}\n` +
      `  Error 2: ${e2.message}`
    )
  }
}

module.exports = binding
