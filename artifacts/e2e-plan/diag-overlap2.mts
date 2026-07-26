import * as fs from 'node:fs'; import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'
;(global as any).ImageData=NodeImageData as any;(global as any).HTMLCanvasElement=class{} as any
;(global as any).Image=Image as any
;(global as any).document={createElement:(t:string)=>{if(t==='canvas')return createCanvas(1,1) as any;throw new Error(t)}}
;(global as any).URL=URL
import { SgaArchive } from '../../src/lib/sga'
import { parseRgm } from '../../src/lib/rgm'
import { VEHICLES, rgmPath } from '../../src/lib/vehicles'
import { camoClassForMesh, EXCLUDED_CLASSES, MASK_SIZE as S } from '../../src/lib/camo-mask'
const A='/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
function shim(fp:string):File{const fd=fs.openSync(fp,'r');const st=fs.statSync(fp)
 const slice=(s=0,e?:number)=>{const end=e??st.size,len=Math.max(0,end-s)
  return {arrayBuffer:async()=>{const b=Buffer.alloc(len);if(len)fs.readSync(fd,b,0,len,s);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}} as Blob}
 return {name:path.basename(fp),size:st.size,slice} as unknown as File}
/** Rasterise UV0 triangles of ANY mesh list — same convention as camo-mask.ts */
function raster(meshes:any[]){
 const c=createCanvas(S,S); const ctx=c.getContext('2d')
 ctx.clearRect(0,0,S,S); ctx.fillStyle='#fff'
 let uvMin=[9,9], uvMax=[-9,-9], tris=0
 for(const m of meshes){
  const geo=m.geometry; const at=geo?.getAttribute?.('uv'); if(!at) continue
  const uv=at.array as ArrayLike<number>; const idx=geo.getIndex?.()
  const px=(i:number)=>uv[i*2]*S, py=(i:number)=>(1-uv[i*2+1])*S
  for(let k=0;k<at.count;k++){const u=uv[k*2],v=uv[k*2+1]
   if(u<uvMin[0])uvMin[0]=u; if(u>uvMax[0])uvMax[0]=u
   if(v<uvMin[1])uvMin[1]=v; if(v>uvMax[1])uvMax[1]=v}
  const tri=(a:number,b:number,cc:number)=>{ctx.beginPath();ctx.moveTo(px(a),py(a));ctx.lineTo(px(b),py(b));ctx.lineTo(px(cc),py(cc));ctx.closePath();ctx.fill();tris++}
  if(idx){const ia=idx.array as ArrayLike<number>; for(let t=0;t+2<ia.length;t+=3) tri(ia[t],ia[t+1],ia[t+2])}
  else for(let v=0;v+2<at.count;v+=3) tri(v,v+1,v+2)
 }
 const d=ctx.getImageData(0,0,S,S).data
 const bm=new Uint8Array(S*S); let n=0
 for(let i=0,j=0;i<d.length;i+=4,j++){ if(d[i+3]>=250){bm[j]=1;n++} }
 return {bm,pct:n/(S*S)*100,tris,uvMin,uvMax}
}
;(async()=>{
 for(const id of ['tiger','churchill','m4a3_sherman_76mm']){
  const v=VEHICLES.find(x=>x.id===id)!
  let meshes:any[]|null=null
  for(const n of fs.readdirSync(A).filter(f=>f.endsWith('.sga'))){
   let a:any;try{a=await SgaArchive.open(shim(path.join(A,n)))}catch{continue}
   try{const b=await a.readByPath(rgmPath(v));if(b){meshes=(parseRgm(b) as any).meshes;break}}catch{}}
  if(!meshes){console.log(id,'no rgm');continue}
  const armor=meshes.filter(m=>!EXCLUDED_CLASSES.has(camoClassForMesh(m,v.id,v.faction as any)))
  const excl =meshes.filter(m=> EXCLUDED_CLASSES.has(camoClassForMesh(m,v.id,v.faction as any)))
  const RA=raster(armor), RE=raster(excl)
  let both=0; for(let i=0;i<RA.bm.length;i++) if(RA.bm[i]&&RE.bm[i]) both++
  console.log(`\n=== ${id} (${v.faction}) ===`)
  console.log(`  armor    ${armor.length} meshes  ${RA.pct.toFixed(2)}% of atlas  tris=${RA.tris}  uv u[${RA.uvMin[0].toFixed(2)},${RA.uvMax[0].toFixed(2)}] v[${RA.uvMin[1].toFixed(2)},${RA.uvMax[1].toFixed(2)}]`)
  console.log(`  excluded ${excl.length} meshes  ${RE.pct.toFixed(2)}% of atlas  tris=${RE.tris}  uv u[${RE.uvMin[0].toFixed(2)},${RE.uvMax[0].toFixed(2)}] v[${RE.uvMin[1].toFixed(2)},${RE.uvMax[1].toFixed(2)}]`)
  console.log(`  overlap  ${(both/(S*S)*100).toFixed(2)}% of atlas = ${(both/Math.max(1,RA.bm.reduce((a,b)=>a+b,0))*100).toFixed(1)}% OF ARMOR ERASED`)
 }
})()
