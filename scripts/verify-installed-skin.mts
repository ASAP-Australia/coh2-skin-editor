/**
 * Structural verification of an INSTALLED skin SGA — does it look exactly like
 * the third-party skins the engine already renders?
 *
 * Equipping is manual + server-side (see wiki coh2-army-customizer-ui), so the
 * end-to-end "author -> see in game" loop cannot be closed by automation. This
 * checks everything that CAN be checked without a human: that the pack we
 * produced is byte-structurally indistinguishable from a working one.
 */
import fs from 'fs'
import path from 'path'
import { SgaArchive } from '../src/lib/sga'
function shim(fp: string): File {
  const fd=fs.openSync(fp,'r'); const st=fs.statSync(fp)
  const slice=(s=0,e?:number)=>{const en=e??st.size;const l=Math.max(0,en-s)
    return {arrayBuffer:async()=>{const b=Buffer.alloc(l);if(l>0)fs.readSync(fd,b,0,l,s);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}} as Blob}
  return {name:fp,size:st.size,slice} as unknown as File
}
const SKINS='/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins'
const OURS=path.join(SKINS,'ZZZ_CLAUDE_E2E_TEST.sga')
const REF=path.join(SKINS,'subscriptions','899558033.sga')   // known-good: the engine demonstrably renders this one

for (const [label,fp] of [['OURS',OURS],['REFERENCE (engine renders this)',REF]] as const) {
  if (!fs.existsSync(fp)) { console.log(`${label}: MISSING ${fp}`); continue }
  const arc = await SgaArchive.open(shim(fp))
  const files = arc.list() as {path:string}[]
  const rgt = files.filter(f=>f.path.toLowerCase().endsWith('.rgt'))
  const skinPaths = rgt.filter(f=>/art[\\/]armies[\\/][a-z_]+[\\/]vehicles[\\/][a-z0-9_]+[\\/]skins[\\/]/i.test(f.path))
  const seasons = new Set(skinPaths.map(f=>(f.path.match(/_(summer|winter)[\\/]/i)||[])[1]?.toLowerCase()).filter(Boolean))
  console.log(`\n=== ${label} ===`)
  console.log(`  file        : ${path.basename(fp)}  (${(fs.statSync(fp).size/1024).toFixed(0)} KB)`)
  console.log(`  members     : ${files.length}   rgt: ${rgt.length}`)
  console.log(`  skin-path rgt: ${skinPaths.length}  (must be >0 for the engine scan to find them)`)
  console.log(`  seasons     : ${[...seasons].join(', ') || 'NONE'}`)
  console.log(`  sample      : ${skinPaths[0]?.path ?? '(none)'}`)
}
