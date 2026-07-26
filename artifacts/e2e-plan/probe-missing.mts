import * as fs from 'node:fs'; import * as path from 'node:path'
import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'
;(global as any).ImageData=NodeImageData as any;(global as any).HTMLCanvasElement=class{} as any
;(global as any).Image=Image as any
;(global as any).document={createElement:(t:string)=>{if(t==='canvas')return createCanvas(1,1) as any;throw new Error(t)}}
;(global as any).URL=URL
import { SgaArchive } from '../../src/lib/sga'
const INSTALL='/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2'
const A=path.join(INSTALL,'CoH2/Archives')
function shim(fp:string):File{const fd=fs.openSync(fp,'r');const st=fs.statSync(fp)
 const slice=(s=0,e?:number)=>{const end=e??st.size,len=Math.max(0,end-s)
  return {arrayBuffer:async()=>{const b=Buffer.alloc(len);if(len)fs.readSync(fd,b,0,len,s);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}} as Blob}
 return {name:path.basename(fp),size:st.size,slice} as unknown as File}
;(async()=>{
 const want:RegExp[]=[]
 const hits=new Set<string>()
 for(const n of fs.readdirSync(A).filter(f=>f.toLowerCase().endsWith('.sga'))){
  let a:any;try{a=await SgaArchive.open(shim(path.join(A,n)))}catch{continue}
  let paths:string[]=[];try{paths=a.listPaths?a.listPaths():[]}catch{}
  for(const p of paths){ if(!/_dif\.rgt$/i.test(p))continue
   hits.add(p) }
 }
 const sorted=[...hits].sort()
 fs.writeFileSync('artifacts/e2e-plan/all-dif-paths.txt', sorted.join('\n')+'\n')
 const folders=new Set(sorted.map(p=>p.split('/').slice(0,4).join('/')))
 fs.writeFileSync('artifacts/e2e-plan/all-vehicle-folders.txt',[...folders].sort().join('\n')+'\n')
 console.log('total _dif paths: '+sorted.length+'  vehicle folders: '+folders.size)
 for(const f of [...folders].sort()) if(/sherman|aec/i.test(f)) console.log('  CANDIDATE '+f)
})()
