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
function ext(m:any){const at=m.geometry?.getAttribute?.('uv'); if(!at)return null
 const uv=at.array as ArrayLike<number>; let u0=9,u1=-9,v0=9,v1=-9
 for(let k=0;k<at.count;k++){const u=uv[k*2],v=uv[k*2+1]; if(u<u0)u0=u;if(u>u1)u1=u;if(v<v0)v0=v;if(v>v1)v1=v}
 return {u0,u1,v0,v1}}
function raster(ms:any[]){const c=createCanvas(S,S);const ctx=c.getContext('2d');ctx.clearRect(0,0,S,S);ctx.fillStyle='#fff'
 for(const m of ms){const g=m.geometry;const at=g?.getAttribute?.('uv');if(!at)continue
  const uv=at.array as ArrayLike<number>;const idx=g.getIndex?.()
  const px=(i:number)=>uv[i*2]*S,py=(i:number)=>(1-uv[i*2+1])*S
  const tri=(a:number,b:number,cc:number)=>{ctx.beginPath();ctx.moveTo(px(a),py(a));ctx.lineTo(px(b),py(b));ctx.lineTo(px(cc),py(cc));ctx.closePath();ctx.fill()}
  if(idx){const ia=idx.array as ArrayLike<number>;for(let t=0;t+2<ia.length;t+=3)tri(ia[t],ia[t+1],ia[t+2])}
  else for(let v=0;v+2<at.count;v+=3)tri(v,v+1,v+2)}
 const d=ctx.getImageData(0,0,S,S).data;const bm=new Uint8Array(S*S);let n=0
 for(let i=0,j=0;i<d.length;i+=4,j++)if(d[i+3]>=250){bm[j]=1;n++}
 return {bm,n}}
// ---- THE COMPLETE PROPOSED FIX ----
const RECLASSIFY_TO_ARMOR = new Set(['geo_hullgun_01','geo_hullgun_02'])  // hull MG = hull fitting, shares hull texture
function isMaskable(m:any, v:any){
  const key = m.materialName || m.name || ''
  if (RECLASSIFY_TO_ARMOR.has(key)) return false            // (3) reclassified
  const c = camoClassForMesh(m, v.id, v.faction)
  if (!EXCLUDED_CLASSES.has(c)) return false
  if (c === 'wreck') return false                            // (1) wreck reuses hull UVs
  const e = ext(m); if (!e) return false
  return e.u0>=-0.05 && e.u1<=1.05 && e.v0>=-0.05 && e.v1<=1.05   // (2) tiling => own texture
}
;(async()=>{
 for(const id of VEHICLES.map(x=>x.id)){
  const v=VEHICLES.find(x=>x.id===id)!;
  let meshes:any[]|null=null
  for(const n of fs.readdirSync(A).filter(f=>f.endsWith('.sga'))){
   let a:any;try{a=await SgaArchive.open(shim(path.join(A,n)))}catch{continue}
   try{const b=await a.readByPath(rgmPath(v));if(b){meshes=(parseRgm(b) as any).meshes;break}}catch{}}
  if(!meshes){console.log(`${id}: no rgm`);continue}
  const cls=(m:any)=>camoClassForMesh(m,v.id,v.faction as any)
  const armorOld=meshes.filter(m=>!EXCLUDED_CLASSES.has(cls(m)))
  const armorNew=meshes.filter(m=>!isMaskable(m,v))
  const RA=raster(armorOld); const armorN=RA.n||1
  const OLD=raster(meshes.filter(m=>EXCLUDED_CLASSES.has(cls(m))))
  const NEW=raster(meshes.filter(m=>isMaskable(m,v)))
  const ov=(bm:Uint8Array)=>{let n=0;for(let i=0;i<RA.bm.length;i++)if(RA.bm[i]&&bm[i])n++;return n}
  console.log(`${id.padEnd(20)} armor ${(RA.n/(S*S)*100).toFixed(1).padStart(5)}%  |  mask ${OLD.n?(OLD.n/(S*S)*100).toFixed(1):'0.0'}%->${(NEW.n/(S*S)*100).toFixed(1).padStart(5)}%  |  ARMOR ERASED ${(ov(OLD.bm)/armorN*100).toFixed(1).padStart(5)}% -> ${(ov(NEW.bm)/armorN*100).toFixed(1).padStart(5)}%`)
 }
})()
