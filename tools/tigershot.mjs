import { WebSocket } from 'ws'
import { writeFileSync } from 'fs'
const BASE='http://localhost:9223'
const t=await fetch(`${BASE}/json`).then(r=>r.json())
const page=t.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)
const ws=new WebSocket(page.webSocketDebuggerUrl)
let id=1;const pend=new Map()
const send=(m,p={})=>new Promise((res,rej)=>{pend.set(id,{res,rej});ws.send(JSON.stringify({id:id++,method:m,params:p}))})
ws.on('message',r=>{const m=JSON.parse(r.toString());if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result)}})
await new Promise(r=>ws.on('open',r))
await send('Runtime.enable')
const ev=e=>send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}).then(r=>r?.result?.value)
const ok=await ev(`(()=>{const els=[...document.querySelectorAll('[title]')];const el=els.find(e=>e.getAttribute('title')==='Tiger I');if(el){(el.closest('button')||el).click();return true}return false})()`)
console.error('clicked tiger:',ok)
await new Promise(r=>setTimeout(r,16000))
const r=await send('Page.captureScreenshot',{format:'png'})
writeFileSync('/tmp/coh2-perf/tiger-final.png',Buffer.from(r.data,'base64'))
console.error('saved tiger-final')
ws.close();process.exit(0)
