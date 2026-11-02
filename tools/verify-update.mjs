// 点击界面上的「立即更新」并按时间点截图
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const port = Number(process.env.CDP_PORT || 10323)

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
const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) {
  console.error('no page')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let idc = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
await new Promise((r) => ws.addEventListener('open', r))
const send = (method, params) =>
  new Promise((res) => {
    const id = ++idc
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evalJs = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value

const clicked = await evalJs(
  `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('立即更新')); if(!b) return 'no-button'; b.click(); return 'clicked' })()`
)
console.log('点击结果:', clicked)
ws.close()

// 截图
const shot = async (file) => {
  await run('powershell', [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${file}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`
  ])
  console.log('截图:', file)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(2500)
await shot('D:\\Temp\\verify-1.png')
await sleep(2500)
await shot('D:\\Temp\\verify-2.png')
await sleep(3500)
await shot('D:\\Temp\\verify-3.png')
await sleep(4000)
await shot('D:\\Temp\\verify-4.png')
