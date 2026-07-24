#!/usr/bin/env node
/**
 * coh2-dev-mcp — minimal stdio MCP server exposing the CoH2 skin-editor
 * decal/faceplate verifiers to an MCP client (e.g. a Claude session).
 *
 * Tools:
 *   - verify_unwrap_analytical   runs scripts/verify-unwrap-analytical.mts (fast,
 *                                pure-Node, no Electron) and returns the parsed
 *                                summary {renders,missing,smear,noTc1,skipped,problems[]}.
 *   - verify_faceplate           runs scripts/verify-faceplate.mts (fast, pure-Node)
 *                                and returns its JSON summary (deltas + DDS + verdict).
 *   - verify_unwrap_visual_report  does NOT run the (slow, Electron) visual sweep;
 *                                it READS the last artifacts/verify-unwrap/visual-results.json
 *                                and returns the verdict summary. Running the sweep
 *                                (`npm run verify:visual`) is a separate manual step.
 *
 * Dependency-light + start-fast: the only imports at module load are the MCP SDK
 * and zod (both already devDependencies). The verifier scripts are spawned
 * on-demand via child_process; nothing heavy is imported until a tool is called.
 *
 * Run standalone (stdio):  node tools/coh2-dev-mcp/server.mjs
 * Registered in .mcp.json as server "coh2-dev".
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Repo root = two levels up from tools/coh2-dev-mcp/
const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..')
const ARTIFACTS = path.join(ROOT, 'artifacts', 'verify-unwrap')
const TSCONFIG = 'tsconfig.node.json'

/** Run a .mts verifier script under tsx, capturing stdout/stderr. */
function runScript(relScript) {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['tsx', '--tsconfig', TSCONFIG, relScript],
      { cwd: ROOT, env: process.env },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message }))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/** Wrap any payload as an MCP tool text result (pretty JSON). */
function jsonResult(payload, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError }
}

const server = new McpServer({ name: 'coh2-dev', version: '1.0.0' })

// ── verify_unwrap_analytical ──────────────────────────────────────────────────
server.registerTool(
  'verify_unwrap_analytical',
  {
    title: 'Verify decal unwrap (analytical)',
    description:
      'Run the fast, pure-Node analytical decal-unwrap verifier ' +
      '(scripts/verify-unwrap-analytical.mts) over all vehicle RGMs. No Electron/GPU. ' +
      'Parses each vehicle\'s TEXCOORD1 exactly as the editor does and checks whether ' +
      'the national-insignia decal lands in the badge shader window. Returns a summary ' +
      '{renders, missing, smear, noTc1, skipped, total, problems[]}. Takes ~seconds.',
    inputSchema: {},
  },
  async () => {
    const run = await runScript('scripts/verify-unwrap-analytical.mts')
    let data
    try {
      data = await readJson(path.join(ARTIFACTS, 'analytical-results.json'))
    } catch (e) {
      return jsonResult(
        { ok: false, error: 'could not read analytical-results.json: ' + e.message, exitCode: run.code, stderr: run.stderr.slice(-2000) },
        true,
      )
    }
    const c = data.counts || {}
    const problems = (data.results || [])
      .filter((r) => ['MISSING', 'SMEAR-RISK', 'SKIPPED'].includes(r.verdict))
      .map((r) => ({ id: r.id, faction: r.faction, verdict: r.verdict, vFlipWouldFix: r.vFlipWouldFix, evidence: r.evidence }))
    return jsonResult({
      ok: run.code === 0,
      exitCode: run.code,
      total: data.total,
      renders: c.RENDERS ?? 0,
      missing: c.MISSING ?? 0,
      smear: c['SMEAR-RISK'] ?? 0,
      noTc1: c['NO-TC1'] ?? 0,
      skipped: c.SKIPPED ?? 0,
      problems,
      generatedAt: data.generatedAt,
    })
  },
)

// ── verify_faceplate ──────────────────────────────────────────────────────────
server.registerTool(
  'verify_faceplate',
  {
    title: 'Verify faceplate export round-trip',
    description:
      'Run the pure-Node faceplate export round-trip verifier ' +
      '(scripts/verify-faceplate.mts). Composites a representative 692×204 atlas ' +
      '(image+text+shape layers), encodes it with the ACTUAL export code ' +
      '(encodeBc3 + wrapBc3InDds), decodes it back (decodeBc3), and compares per pixel. ' +
      'Returns {verdict, deltas, dds, thresholds}. No Electron. Takes ~seconds.',
    inputSchema: {},
  },
  async () => {
    const run = await runScript('scripts/verify-faceplate.mts')
    let data
    try {
      data = await readJson(path.join(ARTIFACTS, 'faceplate-results.json'))
    } catch (e) {
      return jsonResult(
        { ok: false, error: 'could not read faceplate-results.json: ' + e.message, exitCode: run.code, stderr: run.stderr.slice(-2000) },
        true,
      )
    }
    return jsonResult({
      ok: run.code === 0 && data.verdict === 'PASS',
      exitCode: run.code,
      verdict: data.verdict,
      deltas: data.deltas,
      thresholds: data.thresholds,
      dds: data.dds,
      blocks: data.blocks,
      limitation: data.limitation,
      generatedAt: data.generatedAt,
    })
  },
)

// ── verify_unwrap_visual_report ───────────────────────────────────────────────
server.registerTool(
  'verify_unwrap_visual_report',
  {
    title: 'Read visual-sweep report (does NOT run the sweep)',
    description:
      'READ-ONLY. Returns the verdict summary from the LAST visual-unwrap sweep by ' +
      'reading artifacts/verify-unwrap/visual-results.json. This tool does NOT run the ' +
      'sweep — the visual sweep is SLOW (~30-45 min, spawns a hidden Electron) and must ' +
      'be run manually as a separate step (`npm run verify:visual`). If no results file ' +
      'exists, tells you to run the sweep first. Returns {counts, total, drift[], problems[]}.',
    inputSchema: {},
  },
  async () => {
    let data
    try {
      data = await readJson(path.join(ARTIFACTS, 'visual-results.json'))
    } catch (e) {
      return jsonResult({
        ok: false,
        error: 'no visual-results.json found: ' + e.message,
        hint: 'Run the visual sweep first: `npm run verify:visual` (SLOW ~30-45min, spawns hidden Electron).',
      }, true)
    }
    const c = data.counts || {}
    const problems = (data.results || [])
      .filter((r) => !['PASS'].includes(r.verdict))
      .map((r) => ({ id: r.id, faction: r.faction, verdict: r.verdict, footprintPx: r.footprintPx, notes: r.notes }))
    const drift = (data.results || [])
      .filter((r) => r.verdict === 'DRIFT' || (typeof r.goldenDriftFrac === 'number' && r.goldenDriftFrac > 0))
      .map((r) => ({ id: r.id, goldenDriftFrac: r.goldenDriftFrac }))
    return jsonResult({
      ok: true,
      note: 'READ-ONLY: this is the last saved sweep result; run `npm run verify:visual` to refresh.',
      generatedAt: data.generatedAt,
      goldenMode: data.goldenMode,
      total: data.totalVehicles,
      counts: c,
      vflipFixed: (data.vflipFixed || []).map((v) => v.id),
      drift,
      problems,
    })
  },
)

// ── Start over stdio ──────────────────────────────────────────────────────────
const transport = new StdioServerTransport()
await server.connect(transport)
// Keep alive on stdio; do not write to stdout (reserved for the JSON-RPC channel).
console.error('[coh2-dev-mcp] ready — 3 tools registered')
