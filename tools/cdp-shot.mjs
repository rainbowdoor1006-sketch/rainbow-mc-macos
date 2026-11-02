// 对运行中的启动器页面截图（CDP Page.captureScreenshot）
import http from 'node:http'
import { writeFileSync } from 'node:fs'

const port = Number(process.env.CDP_PORT || 10002)
const outFile = process.argv[2] || 'panel.png'

const getJson = (path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(d))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })

// 极简 WebSocket 客户端（避免装 ws 依赖）
import { createHash, randomBytes } from 'node:crypto'
import net from 'node:net'

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const key = randomBytes(16).toString('base64')
    const sock = net.connect(Number(u.port), u.hostname, () => {
      sock.write(
        `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      )
    })
    let handshook = false
    let buf = Buffer.alloc(0)
    const pending = new Map()
    let idc = 0
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      if (!handshook) {
        const idx = buf.indexOf('\r\n\r\n')
        if (idx < 0) return
        handshook = true
        buf = buf.subarray(idx + 4)
        resolve({ send, close: () => sock.destroy() })
      }
      // 解析帧
      while (buf.length >= 2) {
        const len0 = buf[1] & 0x7f
        let off = 2
        let len = len0
        if (len0 === 126) {
          if (buf.length < 4) return
          len = buf.readUInt16BE(2)
          off = 4
        } else if (len0 === 127) {
          if (buf.length < 10) return
          len = Number(buf.readBigUInt64BE(2))
          off = 10
        }
        if (buf.length < off + len) return
        const payload = buf.subarray(off, off + len)
        buf = buf.subarray(off + len)
        try {
          const msg = JSON.parse(payload.toString('utf8'))
          if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg)
            pending.delete(msg.id)
          }
        } catch {
          /* ignore */
        }
      }
    })
    sock.on('error', reject)
    function send(method, params) {
      return new Promise((res) => {
        const id = ++idc
        pending.set(id, res)
        const body = Buffer.from(JSON.stringify({ id, method, params }), 'utf8')
        const mask = randomBytes(4)
        let header
        if (body.length < 126) {
          header = Buffer.from([0x81, 0x80 | body.length])
        } else {
          header = Buffer.alloc(4)
          header[0] = 0x81
          header[1] = 0x80 | 126
          header.writeUInt16BE(body.length, 2)
        }
        const masked = Buffer.from(body)
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]
        sock.write(Buffer.concat([header, mask, masked]))
      })
    }
  })
}

const targets = await getJson('/json')
const page = targets.find((t) => t.type === 'page' && (t.url.includes('index.html') || t.url.startsWith('file:')))
if (!page) {
  console.error('没找到页面 target')
  process.exit(1)
}
const ws = await wsConnect(page.webSocketDebuggerUrl)
await ws.send('Page.enable', {})
const shot = await ws.send('Page.captureScreenshot', { format: 'png' })
if (!shot.result?.data) {
  console.error('截图失败', JSON.stringify(shot).slice(0, 200))
  process.exit(1)
}
writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'))
console.log('已保存', outFile)
ws.close()
process.exit(0)
