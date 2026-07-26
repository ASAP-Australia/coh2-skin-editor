import * as fs from 'node:fs'; import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'
;(global as any).ImageData=NodeImageData as any;(global as any).HTMLCanvasElement=class{} as any
;(global as any).Image=Image as any
;(global as any).document={createElement:(t:string)=>{if(t==='canvas')return createCanvas(1,1) as any;throw new Error(t)}}
;(global as any).URL=URL
import { SgaArchive } from '../../src/lib/sga'
import { decodeRgt } from '../../src/lib/rgt'
import { bcToCanvas } from '../../src/lib/bc-decode'
const A='/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
const OVR='/var/home/jflessenkemper/dev/coh2-skin-editor/artifacts/created-assets/ingame-override/1785024015416605.sga'
const VPATH='art/armies/german/vehicles/tiger/tiger_dif.rgt'
function shim(fp:string):File{const fd=fs.openSync(fp,'r');const st=fs.statSync(fp)
 const slice=(s=0,e?:number)=>{const end=e??st.size,len=Math.max(0,end-s)
  return {arrayBuffer:async()=>{const b=Buffer.alloc(len);if(len)fs.readSync(fd,b,0,len,s);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}} as Blob}
 return {name:path.basename(fp),size:st.size,slice} as unknown as File}
const rgba=(c:any)=>c.getContext('2d').getImageData(0,0,c.width,c.height).data
async function fromArchive(){
 for(const n of fs.readdirSync(A).filter(f=>f.endsWith('.sga'))){
  let a:any;try{a=await SgaArchive.open(shim(path.join(A,n)))}catch{continue}
  try{const b=await a.readByPath(VPATH); if(b) return b}catch{}}
 return null}
;(async()=>{
 const van=await fromArchive(); if(!van){console.log('no vanilla');return}
 const ov=await SgaArchive.open(shim(OVR))
 const paths:string[]=ov.listPaths?ov.listPaths():[]
 console.log('override contains:'); paths.forEach(p=>console.log('   '+p))
 const cust=await ov.readByPath(VPATH)
 if(!cust){console.log('!! override has no '+VPATH);return}
 const rv=decodeRgt(van), rc=decodeRgt(cust)
 const cv=bcToCanvas(rv.pixels,rv.width,rv.height,rv.fourCC) as any
 const cc=bcToCanvas(rc.pixels,rc.width,rc.height,rc.fourCC) as any
 const V=rgba(cv), C=rgba(cc)
 let changed=0,total=0,sum=0
 for(let i=0;i<V.length;i+=4){
  total++
  let d=0; for(let k=0;k<3;k++) d=Math.max(d,Math.abs(V[i+k]-C[i+k]))
  sum+=d
  if(d>=8) changed++   // meaningfully repainted
 }
 const pct=changed/total*100
 console.log(`\nDECISIVE: ${pct.toFixed(2)}% of the atlas was repainted by camo (mean |d| ${(sum/total).toFixed(2)})`)
 console.log(pct<20
  ? '  => BRANCH A: camo is being ERASED by the mask (armor is ~57% of atlas). PRODUCT BUG.'
  : '  => BRANCH B: camo covers roughly the armor area. Mask is NOT over-erasing in the real path.')
})()
