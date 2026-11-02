#!/usr/bin/env node
/**
 * 检查线上更新清单：拉取 → 验签 → 比对本地安装包 sha256 → 探测下载地址。
 * 用法: node tools/check-live-update.mjs [本地exe路径]
 */
import { createHash, createPublicKey, verify } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { request } from 'node:https'

const ENDPOINT = 'https://rainbowdoor.icu/api/launcher/version'
const PUBKEY = '6lzLX0k8R9KnKfDHJN64UDnECIbNCL7/4zDafvj7HqE='
const localExe = process.argv[2] || ''

function httpText(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        timeout,
        headers: {
          'user-agent': 'RAINBOWMC-UpdaterCheck/1.0',
          accept: 'application/json,*/*'
        }
      },
      (res) => {
        let d = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }))
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

function httpHead(url, timeout = 20000) {
  return new Promise((resolve) => {
    const req = request(url, { method: 'HEAD', timeout, headers: { 'user-agent': 'RAINBOWMC-UpdaterCheck/1.0' } }, (res) => {
      resolve({ status: res.statusCode, headers: res.headers })
      res.resume()
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 'timeout' })
    })
    req.on('error', (e) => resolve({ status: 'error', error: String(e) }))
    req.end()
  })
}

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(p)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

function rawPub(b64) {
  const raw = Buffer.from(b64, 'base64')
  // 32 字节 ed25519 裸公钥 → SPKI DER
  const der = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    raw
  ])
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

function verifyManifest(mf) {
  const canonical = [mf.version, mf.sha256, String(mf.size), mf.downloadUrl].join('\n')
  try {
    return verify(null, Buffer.from(canonical, 'utf8'), rawPub(PUBKEY), Buffer.from(mf.sig || '', 'base64'))
  } catch (e) {
    return 'err:' + String(e)
  }
}

const r = await httpText(ENDPOINT)
console.log('清单接口:', r.status)
let mf
try {
  const j = JSON.parse(r.body)
  mf = j.latest || j
} catch {
  console.log('返回内容不是 JSON，前 300 字：', r.body.slice(0, 300))
  process.exit(1)
}

console.log('线上版本   :', mf.version, '(versionCode:', mf.versionCode ?? '-', ')')
console.log('downloadUrl:', mf.downloadUrl || mf.url)
console.log('sha256     :', mf.sha256)
console.log('size       :', mf.size, mf.size ? `(${(mf.size / 1048576).toFixed(1)} MB)` : '')
console.log('mandatory  :', mf.mandatory ?? false)
console.log('notes      :', mf.notes || '')
const okSig = verifyManifest(mf)
console.log('验签       :', okSig === true ? '✅ 通过' : `❌ 失败 (${okSig})`)

const head = await httpHead(mf.downloadUrl || mf.url)
console.log('下载地址   :', head.status === 200 ? '✅ 可访问' : `⚠️ ${head.status}`,
  head.headers?.['content-length'] ? `| content-length ${head.headers['content-length']}` : '')

if (localExe) {
  const size = statSync(localExe).size
  const sha = await sha256File(localExe)
  console.log('本地安装包 :', localExe)
  console.log('  本地 sha256:', sha)
  console.log('  与清单一致 :', sha === mf.sha256 ? '✅' : '❌')
  console.log('  大小一致   :', size === mf.size ? '✅' : `❌ 本地 ${size} / 清单 ${mf.size}`)
}
