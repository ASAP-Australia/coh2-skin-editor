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
/** UV extent of one mesh */
function extent(m:any){const at=m.geometry?.getAttribute?.('uv'); if(!at) return null
 const uv=at.array as ArrayLike<number>; let u0=9,u1=-9,v0=9,v1=-9
 for(let k=0;k<at.count;k++){const u=uv[k*2],v=uv[k*2+1]
  if(u<u0)u0=u; if(u>u1)u1=u; if(v<v0)v0=v; if(v>v1)v1=v}
 return {u0,u1,v0,v1}}
/** THE PROPOSED GATE: a submesh only masks the main diffuse if its UVs stay in [0,1] */
const TOL=0.05
function samplesMainDiffuse(m:any){const e=extent(m); if(!e) return false
 return e.u0>=-TOL && e.u1<=1+TOL && e.v0>=-TOL && e.v1<=1+TOL}
function raster(meshes:any[]){
 const c=createCanvas(S,S); const ctx=c.getContext('2d'); ctx.clearRect(0,0,S,S); ctx.fillStyle='#fff'
 for(const m of meshes){const geo=m.geometry; const at=geo?.getAttribute?.('uv'); if(!at) continue
  const uv=at.array as ArrayLike<number>; const idx=geo.getIndex?.()
  const px=(i:number)=>uv[i*2]*S, py=(i:number)=>(1-uv[i*2+1])*S
  const tri=(a:number,b:number,cc:number)=>{ctx.beginPath();ctx.moveTo(px(a),py(a));ctx.lineTo(px(b),py(b));ctx.lineTo(px(cc),py(cc));ctx.closePath();ctx.fill()}
  if(idx){const ia=idx.array as ArrayLike<number>; for(let t=0;t+2<ia.length;t+=3) tri(ia[t],ia[t+1],ia[t+2])}
  else for(let v=0;v+2<at.count;v+=3) tri(v,v+1,v+2)}
 const d=ctx.getImageData(0,0,S,S).data; const bm=new Uint8Array(S*S); let n=0
 for(let i=0,j=0;i<d.length;i+=4,j++) if(d[i+3]>=250){bm[j]=1;n++}
 return {bm,pct:n/(S*S)*100,count:n}}
;(async()=>{
 for(const id of ['tiger','churchill','m4a3_sherman_76mm','is2m_heavy_tank']){
  const v=VEHICLES.find(x=>x.id===id)!; let meshes:any[]|null=null
  for(const n of fs.readdirSync(A).filter(f=>f.endsWith('.sga'))){
   let a:any;try{a=await SgaArchive.open(shim(path.join(A,n)))}catch{continue}
   try{const b=await a.readByPath(rgmPath(v));if(b){meshes=(parseRgm(b) as any).meshes;break}}catch{}}
  if(!meshes){console.log(id,'no rgm');continue}
  const armor=meshes.filter(m=>!EXCLUDED_CLASSES.has(camoClassForMesh(m,v.id,v.faction as any)))
  const excl =meshes.filter(m=> EXCLUDED_CLASSES.has(camoClassForMesh(m,v.id,v.faction as any)))
  const WRECK=new Set(['wreck']);
  const kept = excl.filter(m=>samplesMainDiffuse(m) && !WRECK.has(camoClassForMesh(m,v.id,v.faction as any)))
  const dropped = excl.filter(m=>!samplesMainDiffuse(m) || WRECK.has(camoClassForMesh(m,v.id,v.faction as any)))
  const RA=raster(armor), OLD=raster(excl), NEW=raster(kept)
  const ov=(bm:Uint8Array)=>{let n=0;for(let i=0;i<RA.bm.length;i++) if(RA.bm[i]&&bm[i])n++; return n}
  const armorN=RA.count||1
  console.log(`\n=== ${id} ===`)
  console.log(`  armor ${RA.pct.toFixed(1)}%   excluded meshes ${excl.length} -> kept ${kept.length}, dropped(tiling) ${dropped.length}`)
  console.log(`  mask BEFORE ${OLD.pct.toFixed(2)}%  -> armor erased ${(ov(OLD.bm)/armorN*100).toFixed(1)}%`)
  console.log(`  mask AFTER(no-wreck+gate)  ${NEW.pct.toFixed(2)}%  -> armor erased ${(ov(NEW.bm)/armorN*100).toFixed(1)}%`)
  const byCls:Record<string,number>={}
  for(const m of dropped){const c=camoClassForMesh(m,v.id,v.faction as any); byCls[c]=(byCls[c]||0)+1}
  console.log(`  dropped by class: ${JSON.stringify(byCls)}`)
 }
})()
