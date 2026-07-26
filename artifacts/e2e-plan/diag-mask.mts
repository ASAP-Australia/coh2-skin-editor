import * as fs from 'node:fs'; import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'
;(global as any).ImageData=NodeImageData as any;(global as any).HTMLCanvasElement=class{} as any
;(global as any).Image=Image as any
;(global as any).document={createElement:(t:string)=>{if(t==='canvas')return createCanvas(1,1) as any;throw new Error(t)}}
;(global as any).URL=URL
import { SgaArchive } from '../../src/lib/sga'
import { parseRgm } from '../../src/lib/rgm'
import { VEHICLES, rgmPath } from '../../src/lib/vehicles'
import { buildCamoExclusionMask, camoClassForMesh, EXCLUDED_CLASSES, MASK_SIZE } from '../../src/lib/camo-mask'
const A='/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
function shim(fp:string):File{const fd=fs.openSync(fp,'r');const st=fs.statSync(fp)
 const slice=(s=0,e?:number)=>{const end=e??st.size,len=Math.max(0,end-s)
  return {arrayBuffer:async()=>{const b=Buffer.alloc(len);if(len)fs.readSync(fd,b,0,len,s);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}} as Blob}
 return {name:path.basename(fp),size:st.size,slice} as unknown as File}
const cov=(c:any)=>{if(!c)return 0;const d=c.getContext('2d').getImageData(0,0,MASK_SIZE,MASK_SIZE).data
 let n=0;for(let i=3;i<d.length;i+=4) if(d[i]>=250)n++; return n/(MASK_SIZE*MASK_SIZE)*100}
;(async()=>{
 const v=VEHICLES.find(x=>x.id==='tiger')!
 let buf:any=null
 for(const n of fs.readdirSync(A).filter(f=>f.endsWith('.sga'))){
  let a:any;try{a=await SgaArchive.open(shim(path.join(A,n)))}catch{continue}
  try{const b=await a.readByPath(rgmPath(v));if(b){buf=b;break}}catch{}}
 const meshes:any[]=(parseRgm(buf) as any).meshes
 console.log('tiger meshes:',meshes.length)
 // coverage by class
 const byClass:Record<string,any[]>={}
 for(const m of meshes){const c=camoClassForMesh(m,v.id,v.faction as any); (byClass[c]??=[]).push(m)}
 for(const [c,ms] of Object.entries(byClass)){
   const mask=buildCamoExclusionMask(ms as any, undefined, undefined) // pattern-free: force include
   console.log(`  class ${c.padEnd(16)} n=${String(ms.length).padStart(3)}  excluded=${EXCLUDED_CLASSES.has(c as any)}`)
 }
 // A: map-based (what my verifier does)   B: pattern-based (no vehicle ctx)
 const mA=buildCamoExclusionMask(meshes as any, v.id, v.faction as any)
 const mB=buildCamoExclusionMask(meshes as any)
 console.log(`\nmask coverage  MAP-based: ${cov(mA).toFixed(2)}%   PATTERN-based: ${cov(mB).toFixed(2)}%`)
 // per excluded class, individual coverage
 console.log('\nper-class mask coverage (map classes that are EXCLUDED):')
 for(const [c,ms] of Object.entries(byClass)){
   if(!EXCLUDED_CLASSES.has(c as any))continue
   const only=buildCamoExclusionMask(ms as any, v.id, v.faction as any)
   console.log(`  ${c.padEnd(16)} ${cov(only).toFixed(2)}%  (n=${ms.length})`)
 }
})()
