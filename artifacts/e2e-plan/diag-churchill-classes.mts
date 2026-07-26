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
;(async()=>{
 const v=VEHICLES.find(x=>x.id==='churchill')!
 let meshes:any[]|null=null
 for(const n of fs.readdirSync(A).filter(f=>f.endsWith('.sga'))){
  let a:any;try{a=await SgaArchive.open(shim(path.join(A,n)))}catch{continue}
  try{const b=await a.readByPath(rgmPath(v));if(b){meshes=(parseRgm(b) as any).meshes;break}}catch{}}
 if(!meshes){console.log('no rgm');return}
 const cls=(m:any)=>camoClassForMesh(m,v.id,v.faction as any)
 const armor=meshes.filter(m=>!EXCLUDED_CLASSES.has(cls(m)))
 const RA=raster(armor); const armorN=RA.n||1
 console.log(`churchill: ${meshes.length} meshes, armor ${armor.length} (${(RA.n/(S*S)*100).toFixed(1)}% atlas)\n`)
 const groups:Record<string,any[]>={}
 for(const m of meshes){ const c=cls(m); if(EXCLUDED_CLASSES.has(c)) (groups[c]??=[]).push(m) }
 for(const [c,ms] of Object.entries(groups)){
  const inRange=ms.filter(m=>{const e=ext(m);return e&&e.u0>=-0.05&&e.u1<=1.05&&e.v0>=-0.05&&e.v1<=1.05})
  const R=raster(inRange)
  let ov=0; for(let i=0;i<RA.bm.length;i++) if(RA.bm[i]&&R.bm[i]) ov++
  console.log(`  ${c.padEnd(16)} n=${String(ms.length).padStart(3)} inRange=${String(inRange.length).padStart(3)}  covers ${(R.n/(S*S)*100).toFixed(2)}%  erases ${(ov/armorN*100).toFixed(1)}% of armor`)
  // biggest individual offenders
  const scored=inRange.map(m=>{const r=raster([m]);let o=0;for(let i=0;i<RA.bm.length;i++)if(RA.bm[i]&&r.bm[i])o++;return {m,o}})
    .sort((a,b)=>b.o-a.o).slice(0,3)
  for(const s of scored) if(s.o/armorN>0.01)
    console.log(`      offender: ${(s.m.materialName||s.m.name||'?').slice(0,44).padEnd(44)} erases ${(s.o/armorN*100).toFixed(1)}%`)
 }
})()
