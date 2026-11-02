// 最终验证：点击更新 → 2 秒时截图 → 跟踪完成
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const port = Number(process.env.CDP_PORT || 10326)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  console.error('没有页面目标（可能启动器已退出）')
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
const send = (m, p) =>
  new Promise((res) => {
    const id = ++idc
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method: m, params: p }))
  })
const evalJs = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value

const r = await evalJs(
  `(function(){var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return x.innerText.indexOf('立即更新')>=0})[0];if(!b)return 'no-button';b.click();return 'clicked'})()`
)
console.log('点击:', r)
ws.close()

await sleep(2000)
await run('powershell', [
  '-NoProfile',
  '-Command',
  `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('D:\\Temp\\final-2s.png',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`
])
console.log('截图完成: D:\\Temp\\final-2s.png')
