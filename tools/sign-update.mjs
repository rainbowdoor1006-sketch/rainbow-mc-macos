#!/usr/bin/env node
/**
 * 生成「已签名」的更新清单。
 *
 * 用法：
 *   node tools/sign-update.mjs <exe 路径> <版本号> <下载地址> [备注]
 *
 * 私钥从 C:\Users\nw202\.dsh\.secrets\update-signing-key.txt 读取（priv= 那行）。
 * 输出：把 stdout 的 JSON 原样写到服务器上的清单文件（例如 update.json）。
 *
 * 清单里 sig 的签名对象固定为四行：
 *   version \n sha256 \n size \n url
 * 与 update.ts 里的 canonical() 完全一致，改任何一项都必须重新签名。
 */
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [, , exePath, version, downloadUrl, notes = ''] = process.argv
if (!exePath || !version || !downloadUrl) {
  console.error('用法: node tools/sign-update.mjs <exe> <version> <downloadUrl> [notes]')
  process.exit(1)
}

const keyFile = join(homedir(), '.dsh', '.secrets', 'update-signing-key.txt')
const txt = readFileSync(keyFile, 'utf8')
const m = txt.match(/^priv=(.+)$/m)
if (!m) {
  console.error('没读到 priv=，检查 ' + keyFile)
  process.exit(1)
}
const privB64 = m[1].trim()

const size = statSync(exePath).size
const sha256 = createHash('sha256').update(readFileSync(exePath)).digest('hex')
const canonical = [version, sha256, String(size), downloadUrl].join('\n')

// PKCS8 DER（base64）→ KeyObject
const key = createPrivateKey({ key: Buffer.from(privB64, 'base64'), format: 'der', type: 'pkcs8' })
const sig = sign(null, Buffer.from(canonical, 'utf8'), key).toString('base64')

const manifest = {
  version,
  url: downloadUrl,
  downloadUrl,
  sha256,
  size,
  notes,
  mandatory: false,
  sig
}

process.stdout.write(JSON.stringify(manifest, null, 2) + '\n')
console.error(`已签名 ${version} | ${(size / 1048576).toFixed(1)} MB | sha256 ${sha256.slice(0, 12)}…`)
