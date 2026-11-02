// 通过 CDP 触发整合包导入并采样界面进度（只用 Runtime.evaluate，稳）
import http from 'node:http'

const port = Number(process.env.CDP_PORT || 9222)
const mrpack = process.argv[2]
const maxMin = Number(process.argv[3] || 25)

const getJson = (p) =>
  new Promise((res, rej) => {
    http
      .get({ host: '127.0.0.1', port, path: p }, (r) => {
        let d = ''
        r.on('data', (c) => (d += c))
        r.on('end', () => {
          try {
            res(JSON.parse(d))
          } catch (e) {
            rej(e)
          }
        })
      })
      .on('error', rej)
  })

const targets = await getJson('/json')
const page = targets.find((t) => t.type === 'page' && (t.url.includes('index.html') || t.url.startsWith('file:')))
if (!page) {
  console.error('no page target')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let idc = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
await new Promise((r) => ws.addEventListener('open', r))

const send = (method, params) =>
  new Promise((res) => {
    const id = ++idc
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.result?.result?.value
}

// 先挂事件监听（由页面侧记录），再触发导入
await evalJs(`(function(){
  window.__pack = [];
  if (!window.__packHooked) {
    window.__packHooked = true;
    window.api.pack.onProgress(function(p){ window.__pack.push({t: Date.now(), s:p.stage, d:p.done, tt:p.total, n:p.name}); });
  }
  return 'ok';
})()`)

const t0 = Date.now()
console.log('START')
evalJs(`window.api.pack.importPath(${JSON.stringify(mrpack)}).then(r=>{window.__packDone = r})`)

const fmt = (sec) => `${Math.floor(sec / 60)}m${String(Math.round(sec % 60)).padStart(2, '0')}s`
let lastMB = 0
let lastT = Date.now()
let lastSpeed = 0
let sawEnd = false

while ((Date.now() - t0) / 1000 < maxMin * 60) {
  await new Promise((r) => setTimeout(r, 3000))
  const raw = await evalJs(`(function(){
    const l = window.__pack || [];
    const last = l.length ? l[l.length-1] : null;
    const txt = document.body.innerText;
    const m = txt.match(/([\\d.]+) MB \\/ ([\\d.]+) MB/);
    return JSON.stringify({ n: l.length, last, mb: m ? [Number(m[1]), Number(m[2])] : null, done: !!window.__packDone });
  })()`)
  let st = {}
  try {
    st = JSON.parse(raw)
  } catch {
    st = {}
  }
  const el = (Date.now() - t0) / 1000
  if (st.last && st.last.s === 'download' && st.last.d) {
    const mb = st.last.d / 1048576
    const now = Date.now()
    if (mb > lastMB && now > lastT) {
      const inst = ((mb - lastMB) * 1048576) / ((now - lastT) / 1000)
      if (inst > 0) lastSpeed = inst
      lastMB = mb
      lastT = now
    }
    console.log(
      `[${fmt(el)}] 下载 ${mb.toFixed(1)} / ${(st.last.tt / 1048576).toFixed(1)} MB · ${(lastSpeed / 1024).toFixed(0)} KB/s`
    )
  } else if (st.last) {
    console.log(`[${fmt(el)}] stage=${st.last.s} ${st.last.n || ''}`)
  } else {
    console.log(`[${fmt(el)}] 等待…`)
  }
  if (st.done) {
    sawEnd = true
    break
  }
  if (st.last && st.last.s === 'loader') {
    sawEnd = true
    break
  }
}

const secs = (Date.now() - t0) / 1000
console.log('END', sawEnd ? 'ok' : 'timeout', 'elapsed=' + fmt(secs), 'lastMB=' + lastMB.toFixed(1), 'speed~' + (lastSpeed / 1024).toFixed(0) + 'KB/s')
const res = await evalJs('JSON.stringify(window.__packDone || null)')
console.log('import result:', res)
ws.close()
process.exit(0)
