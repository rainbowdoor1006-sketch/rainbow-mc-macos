// 每秒截图一次并记录窗口列表，用于验证安装窗口是否可见
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const port = Number(process.env.CDP_PORT || 10325)
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

console.log(
  'click:',
  await evalJs(
    `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('立即更新')); if(!b) return 'no-button'; b.click(); return 'clicked' })()`
  )
)
ws.close()

const psShot = (file) =>
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${file}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`
  ])

for (let i = 1; i <= 12; i++) {
  await sleep(900)
  const titles = await run('powershell', [
    '-NoProfile',
    '-Command',
    `(Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty MainWindowTitle) -join ' | '`
  ])
  console.log(`t=${i}s windows: ${titles.stdout.trim()}`)
  await psShot(`D:\\Temp\\seq-${i}.png`)
}
