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
function alpha(c:any){const d=c.getContext('2d').getImageData(0,0,MASK_SIZE,MASK_SIZE).data
 const out=new Uint8Array(MASK_SIZE*MASK_SIZE); for(let i=0,j=0;i<d.length;i+=4,j++) out[j]=d[i+3]>=250?1:0; return out}
async function load(id:string){
 const v=VEHICLES.find(x=>x.id===id)!
 for(const n of fs.readdirSync(A).filter(f=>f.endsWith('.sga'))){
  let a:any;try{a=await SgaArchive.open(shim(path.join(A,n)))}catch{continue}
  try{const b=await a.readByPath(rgmPath(v));if(b)return {v,meshes:(parseRgm(b) as any).meshes as any[]}}catch{}}
 throw new Error('rgm not found '+id)
}
;(async()=>{
 for(const id of ['tiger','churchill']){
  const {v,meshes}=await load(id)
  const armor=meshes.filter(m=>!EXCLUDED_CLASSES.has(camoClassForMesh(m,v.id,v.faction as any)))
  const excl =meshes.filter(m=> EXCLUDED_CLASSES.has(camoClassForMesh(m,v.id,v.faction as any)))
  const mA=buildCamoExclusionMask(armor as any, undefined, undefined)  // force-rasterise armor UVs
  const mE=buildCamoExclusionMask(excl  as any, undefined, undefined)
  if(!mA||!mE){console.log(id,'could not build one of the masks');continue}
  const a=alpha(mA), e=alpha(mE)
  let ac=0,ec=0,both=0
  for(let i=0;i<a.length;i++){ if(a[i])ac++; if(e[i])ec++; if(a[i]&&e[i])both++ }
  const T=MASK_SIZE*MASK_SIZE
  console.log(`\n=== ${id} ===`)
  console.log(`  armor UV area    : ${(ac/T*100).toFixed(2)}%  (${armor.length} meshes)`)
  console.log(`  excluded UV area : ${(ec/T*100).toFixed(2)}%  (${excl.length} meshes)`)
  console.log(`  OVERLAP          : ${(both/T*100).toFixed(2)}% of atlas`)
  console.log(`  -> ${(both/Math.max(ac,1)*100).toFixed(1)}% of ARMOR area is erased by the exclusion mask`)
 }
})()
