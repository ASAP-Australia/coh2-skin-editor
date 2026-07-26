import { createCanvas, Image, ImageData as NodeImageData } from 'canvas'
;(global as any).ImageData=NodeImageData as any;(global as any).HTMLCanvasElement=class{} as any
;(global as any).Image=Image as any
;(global as any).document={createElement:(t:string)=>{if(t==='canvas')return createCanvas(1,1) as any;throw new Error(t)}}
;(global as any).URL=URL
import { parsePrompt, generateCamo } from '../../src/lib/camo-generator'
const S=2048
function coverage(c:any){const d=c.getContext('2d').getImageData(0,0,S,S).data
 let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>=8) n++; return n/(S*S)*100}
;(async()=>{
 const preset=parsePrompt('german ambush')
 console.log('preset:', JSON.stringify({name:(preset as any).name,maskedMode:(preset as any).maskedMode,style:(preset as any).style}))
 // 1) camo overlay with NO exclusion mask -> intrinsic pattern coverage
 const a=createCanvas(S,S); generateCamo(a as any, preset, null)
 console.log(`intrinsic camo overlay coverage (no mask): ${coverage(a).toFixed(2)}%`)
 // 2) same preset forced maskedMode
 const p2:any={...preset, maskedMode:true}
 const b=createCanvas(S,S); generateCamo(b as any, p2, null)
 console.log(`maskedMode=true, no exclusion mask   : ${coverage(b).toFixed(2)}%`)
})()
