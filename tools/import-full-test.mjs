/**
 * 用新流水线完整导入 JWR II 整合包，并输出各阶段耗时与最终统计。
 * 用法：node tools\import-full-test.mjs "<zip 路径>" [项目名前缀]
 */
const zip = process.argv[2]
const prefix = process.argv[3] || 'TEST-FULL'
const base = 'http://127.0.0.1:' + (process.env.CDP_PORT || '9670')

const list = await (await fetch(base + '/json/list')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error)
    pending.delete(m.id)
  }
}
function send(method, params = {}) {
  const myId = ++id
  return new Promise((res) => {
    pending.set(myId, res)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r?.result?.value
}

await evaluate(`(() => {
  window.__ev = []
  window.api.pack.onProgress((p) => window.__ev.push({ t: Date.now(), stage: p.stage, name: p.name || '' }))
  window.__t0 = Date.now()
  return 'hooked'
})()`)

const name = prefix + '-' + Date.now()
console.log('开始导入：', name)
const t0 = Date.now()

// 导入是长任务，用轮询方式跑，避免单次 evaluate 超时
await evaluate(`(() => { window.__done = null; window.__res = null;
  window.api.pack.importPath(${JSON.stringify(zip)}, ${JSON.stringify(name)})
    .then((r) => { window.__res = r }).catch((e) => { window.__res = { ok: false, message: String(e) } })
    .finally(() => { window.__done = true })
  return 'started'
})()`)

let lastCount = 0
for (;;) {
  await new Promise((r) => setTimeout(r, 15000))
  const st = await evaluate(`(() => {
    const ev = window.__ev || []
    const last = ev[ev.length - 1] || {}
    return JSON.stringify({ done: !!window.__done, res: window.__res, n: ev.length, last: last.name || '', stage: last.stage || '' })
  })()`)
  const s = JSON.parse(st)
  if (s.n !== lastCount) {
    console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${s.stage} | ${String(s.last).slice(0, 70)}`)
    lastCount = s.n
  }
  if (s.done) {
    const sec = Math.round((Date.now() - t0) / 1000)
    console.log('\n导入结果：', JSON.stringify(s.res))
    console.log('总耗时：', sec, '秒 =', (sec / 60).toFixed(1), '分钟')
    break
  }
  if (Date.now() - t0 > 60 * 60 * 1000) {
    console.log('超时 60 分钟，放弃等待')
    break
  }
}
ws.close()
