/**
 * 用 CDP 在启动器里执行一段 JS，并打印返回值。
 * 用法：node tools\cdp-file.mjs <js文件路径>
 */
import fs from 'node:fs'

const file = process.argv[2]
const code = fs.readFileSync(file, 'utf8')
const port = process.env.CDP_PORT || '9222'

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('没有页面目标')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

const id = 1
const result = await new Promise((resolve) => {
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id === id) resolve(m.result)
  }
  ws.send(
    JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression: code, awaitPromise: true, returnByValue: true }
    })
  )
})
ws.close()
const val = result?.result?.value
console.log(typeof val === 'string' ? val : JSON.stringify(val))
