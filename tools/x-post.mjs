#!/usr/bin/env node
/**
 * 发推工具（X / Twitter 官方 API v2，OAuth 2.0 PKCE，免费档）
 *
 * 用法：
 *   node tools\x-post.mjs auth            首次授权（会打开浏览器）
 *   node tools\x-post.mjs post "文本..."   发一条推文
 *   node tools\x-post.mjs post --file a.txt  从文件读文本（用 --- 分隔可发串推）
 *   node tools\x-post.mjs post --dry-run "文本..."   只打印不发
 *   node tools\x-post.mjs whoami          看当前授权账号与额度信息
 *   node tools\x-post.mjs --help
 *
 * 凭据存放：C:\Users\<你>\.dsh\.secrets\x-auth.json（不进任何仓库）
 * 免费档限制：约 500 帖/月；读接口很有限；图片上传通常需要 Basic($200/月)，故本脚本只发文本。
 *
 * 前置：在 https://developer.x.com 创建 App →
 *   User authentication settings → OAuth 2.0 → Type of App: Web App / Automated App or Bot
 *   Callback URI 填：http://127.0.0.1:8787/callback
 *   Scopes 勾：tweet.read tweet.write users.read offline.access
 *   拿到 Client ID（Public client 不需要 Secret），填进 x-auth.json 的 clientId
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const SECRET_DIR = join(homedir(), '.dsh', '.secrets')
const AUTH_FILE = join(SECRET_DIR, 'x-auth.json')
const CALLBACK_PORT = 8787
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access']
const AUTH_HOST = 'https://x.com'
const API_HOST = 'https://api.x.com'

function loadAuth() {
  if (!existsSync(AUTH_FILE)) return { clientId: '', accessToken: '', refreshToken: '', expiresAt: 0 }
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf8'))
  } catch {
    return { clientId: '', accessToken: '', refreshToken: '', expiresAt: 0 }
  }
}

function saveAuth(a) {
  mkdirSync(SECRET_DIR, { recursive: true })
  writeFileSync(AUTH_FILE, JSON.stringify(a, null, 2), 'utf8')
  console.log('· 凭据已保存到', AUTH_FILE)
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function api(path, opts = {}) {
  const auth = loadAuth()
  const token = await ensureToken(auth)
  const res = await fetch(`${API_HOST}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const msg = data?.detail || data?.title || data?.error_description || text.slice(0, 300)
    throw new Error(`HTTP ${res.status}：${msg}`)
  }
  return data
}

async function ensureToken(auth) {
  if (!auth.accessToken) throw new Error('还没授权，先运行：node tools\\x-post.mjs auth')
  if (Date.now() < (auth.expiresAt || 0) - 60_000) return auth.accessToken
  if (!auth.refreshToken) throw new Error('token 已过期且没有 refresh_token，请重新 auth')
  console.log('· access token 已过期，正在刷新…')
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    client_id: auth.clientId
  })
  const res = await fetch(`${AUTH_HOST}/2/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`刷新失败 HTTP ${res.status}：${(await res.text()).slice(0, 200)}`)
  const j = await res.json()
  const next = {
    ...auth,
    accessToken: j.access_token,
    refreshToken: j.refresh_token || auth.refreshToken,
    expiresAt: Date.now() + (j.expires_in ?? 7200) * 1000
  }
  saveAuth(next)
  return next.accessToken
}

async function cmdAuth() {
  const auth = loadAuth()
  const clientId = process.argv[3] || auth.clientId
  if (!clientId) {
    console.error(
      '缺少 Client ID。\n' +
        '  1) 打开 https://developer.x.com → 你的 App → User authentication settings\n' +
        '  2) OAuth 2.0 打开，Type 选 Web App / Automated App or Bot\n' +
        `  3) Callback URI 填 ${REDIRECT_URI}\n` +
        '  4) Scopes 勾：tweet.read tweet.write users.read offline.access\n' +
        '  5) 把 Client ID 传进来：node tools\\x-post.mjs auth <CLIENT_ID>'
    )
    process.exit(1)
  }

  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))
  const url =
    `${AUTH_HOST}/i/oauth2/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
    `&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`

  console.log('· 正在打开浏览器授权页…')
  console.log('  如果没有自动打开，请手动访问：\n  ' + url + '\n')
  try {
    if (process.platform === 'win32') execFileSync('cmd', ['/c', 'start', '', url])
    else execFileSync('open', [url])
  } catch {
    /* 手动打开 */
  }

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI)
      if (u.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const c = u.searchParams.get('code')
      const err = u.searchParams.get('error')
      const st = u.searchParams.get('state')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<html><body style="font-family:sans-serif;background:#14181a;color:#e8ebe9;padding:40px">
         <h2>${c ? '授权成功' : '授权失败'}</h2><p>${c ? '可以关闭这个页面了。' : err || '未知错误'}</p></body></html>`
      )
      server.close()
      if (err) reject(new Error(err))
      else if (st !== state) reject(new Error('state 不匹配，可能被劫持，已中止'))
      else resolve(c)
    })
    server.listen(CALLBACK_PORT, '127.0.0.1')
    setTimeout(() => {
      server.close()
      reject(new Error('等待授权超时（5 分钟）'))
    }, 300_000)
  })

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    client_id: clientId
  })
  const res = await fetch(`${AUTH_HOST}/2/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`换取 token 失败 HTTP ${res.status}：${(await res.text()).slice(0, 300)}`)
  const j = await res.json()
  saveAuth({
    clientId,
    accessToken: j.access_token,
    refreshToken: j.refresh_token || '',
    expiresAt: Date.now() + (j.expires_in ?? 7200) * 1000
  })
  console.log('✅ 授权完成')
}

function splitThread(text) {
  return text
    .split(/^\s*---+\s*$/m)
    .map((t) => t.trim())
    .filter(Boolean)
}

async function cmdPost(args) {
  const dryRun = args.includes('--dry-run')
  const fileIdx = args.indexOf('--file')
  let text = ''
  if (fileIdx !== -1) {
    text = readFileSync(args[fileIdx + 1], 'utf8')
  } else {
    text = args.filter((a) => !a.startsWith('--')).join(' ')
  }
  if (!text.trim()) {
    console.error('用法：node tools\\x-post.mjs post "文本" / post --file a.txt')
    process.exit(1)
  }
  const tweets = splitThread(text)
  for (const [i, t] of tweets.entries()) {
    if (t.length > 280) {
      console.warn(`⚠ 第 ${i + 1} 条 ${t.length} 字，超过 280，X 会拒绝（免费档不支持长文）`)
    }
  }
  if (dryRun) {
    console.log(`—— 预览（共 ${tweets.length} 条，未发送）——`)
    tweets.forEach((t, i) => console.log(`\n[${i + 1}/${tweets.length}] (${t.length} 字)\n${t}`))
    return
  }
  for (const [i, t] of tweets.entries()) {
    const r = await api('/2/tweets', { method: 'POST', body: JSON.stringify({ text: t }) })
    const id = r?.data?.id
    console.log(`✅ 第 ${i + 1}/${tweets.length} 条已发送：https://x.com/i/web/status/${id}`)
    if (i < tweets.length - 1) await new Promise((r2) => setTimeout(r2, 2000))
  }
}

async function cmdWhoami() {
  const me = await api('/2/users/me?user.fields=public_metrics,verified')
  const u = me?.data
  console.log('账号:', `@${u?.username}`, `(${u?.name})`)
  if (u?.public_metrics) {
    console.log('粉丝:', u.public_metrics.followers_count, '| 关注:', u.public_metrics.following_count)
  }
  const a = loadAuth()
  console.log('token 到期:', new Date(a.expiresAt).toLocaleString('zh-CN'))
  console.log('凭据文件:', AUTH_FILE)
}

const HELP = `X 发推工具（官方 API v2 · 免费档）

  node tools\\x-post.mjs auth <CLIENT_ID>   首次授权（会开浏览器，回调 127.0.0.1:8787）
  node tools\\x-post.mjs post "文本"         发一条
  node tools\\x-post.mjs post --file a.txt  从文件发（用单独一行 --- 分隔可发串推）
  node tools\\x-post.mjs post --dry-run "文本"  只预览不发送
  node tools\\x-post.mjs whoami             查看授权账号
  node tools\\x-post.mjs refresh            手动刷新 token

注意：
  · 免费档约 500 帖/月，读接口极少，图片上传需 Basic（$200/月），所以本脚本只发文本
  · 单条上限 280 字（免费档不支持长文）
  · api.x.com 在国内需要代理；本脚本走系统代理，请确保 VPN/TUN 已开启
  · 凭据在 ${AUTH_FILE}，不要提交到仓库
`

const [, , cmd, ...rest] = process.argv
try {
  if (!cmd || cmd === '--help' || cmd === '-h') console.log(HELP)
  else if (cmd === 'auth') await cmdAuth()
  else if (cmd === 'post') await cmdPost(rest)
  else if (cmd === 'whoami') await cmdWhoami()
  else if (cmd === 'refresh') {
    await ensureToken(loadAuth())
    console.log('✅ token 已刷新')
  } else {
    console.log(HELP)
  }
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e)
  process.exit(1)
}
