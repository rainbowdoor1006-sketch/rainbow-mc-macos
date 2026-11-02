// 触发完整自动更新流程：check → download → apply，然后由外部观察退出/重启
import http from 'node:http'

const port = Number(process.env.CDP_PORT || 10302)

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

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r.result?.result?.value
}

console.log('1) 检查更新')
const chk = JSON.parse(await evalJs(`window.api.update.check('stable').then(r=>JSON.stringify(r))`))
console.log('   state=', chk.state, ' latest=', chk.latest?.version)

console.log('2) 下载安装包')
const dl = JSON.parse(
  await evalJs(`window.api.update.download(${JSON.stringify(chk.latest)}).then(r=>JSON.stringify(r))`)
)
console.log('   ok=', dl.ok, ' path=', dl.path, ' msg=', dl.message || '')

console.log('3) 应用更新（启动器即将退出）')
const applied = JSON.parse(
  await evalJs(`window.api.update.apply(${JSON.stringify(dl.path)}, '0.2.87').then(r=>JSON.stringify(r))`)
)
console.log('   apply=', JSON.stringify(applied))
ws.close()
process.exit(0)
