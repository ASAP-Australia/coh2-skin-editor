import * as fs from 'node:fs'; import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'
;(global as any).ImageData=NodeImageData as any;(global as any).HTMLCanvasElement=class{} as any
;(global as any).Image=Image as any
;(global as any).document={createElement:(t:string)=>{if(t==='canvas')return createCanvas(1,1) as any;throw new Error(t)}}
;(global as any).URL=URL
import { SgaArchive } from '../../src/lib/sga'
import { parseRgm } from '../../src/lib/rgm'
import { VEHICLES, rgmPath } from '../../src/lib/vehicles'
import { camoClassForMesh, EXCLUDED_CLASSES } from '../../src/lib/camo-mask'
const A='/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2/CoH2/Archives'
function shim(fp:string):File{const fd=fs.openSync(fp,'r');const st=fs.statSync(fp)
 const slice=(s=0,e?:number)=>{const end=e??st.size,len=Math.max(0,end-s)
  return {arrayBuffer:async()=>{const b=Buffer.alloc(len);if(len)fs.readSync(fd,b,0,len,s);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}} as Blob}
 return {name:path.basename(fp),size:st.size,slice} as unknown as File}
function ext(m:any){const at=m.geometry?.getAttribute?.('uv'); if(!at)return null
 const uv=at.array as ArrayLike<number>; let u0=9,u1=-9,v0=9,v1=-9
 for(let k=0;k<at.count;k++){const u=uv[k*2],v=uv[k*2+1]; if(u<u0)u0=u;if(u>u1)u1=u;if(v<v0)v0=v;if(v>v1)v1=v}
 return {u0,u1,v0,v1}}
;(async()=>{
 for(const id of ['m21_mortar_halftrack','m15a1_aa_halftrack']){
  const v=VEHICLES.find(x=>x.id===id)!; let meshes:any[]|null=null
  for(const n of fs.readdirSync(A).filter(f=>f.endsWith('.sga'))){
   let a:any;try{a=await SgaArchive.open(shim(path.join(A,n)))}catch{continue}
   try{const b=await a.readByPath(rgmPath(v));if(b){meshes=(parseRgm(b) as any).meshes;break}}catch{}}
  if(!meshes){console.log(`${id}: no rgm`);continue}
  console.log(`\n=== ${id} (${meshes.length} meshes) ===`)
  const seen=new Map<string,{n:number,tile:number,ex:string}>()
  for(const m of meshes){
   const c=camoClassForMesh(m,v.id,v.faction as any); if(!EXCLUDED_CLASSES.has(c)) continue
   const e=ext(m); const tiling = !e || !(e.u0>=-0.05&&e.u1<=1.05&&e.v0>=-0.05&&e.v1<=1.05)
   const k=c; const cur=seen.get(k)??{n:0,tile:0,ex:''}
   cur.n++; if(tiling){cur.tile++; if(!cur.ex&&e) cur.ex=`u[${e.u0.toFixed(2)},${e.u1.toFixed(2)}] v[${e.v0.toFixed(2)},${e.v1.toFixed(2)}]`}
   seen.set(k,cur)
  }
  for(const [c,s] of seen) console.log(`   ${c.padEnd(16)} n=${String(s.n).padStart(3)}  tiling-dropped=${String(s.tile).padStart(3)}  ${s.ex}`)
 }
})()
