import { createServer, type Server } from 'http'
import { AddressInfo } from 'net'
import { shell } from 'electron'
import type { AccountInfo } from '@shared/types'

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const SCOPE = 'XboxLive.signin offline_access'

export interface MsTokens {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

export interface MsProfile {
  id: string
  name: string
  skins?: { id: string; state: string; url: string }[]
}

const UA_JSON = { 'Content-Type': 'application/json', Accept: 'application/json' }

function timeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

/** 打开浏览器走微软授权页，本地回环收 code */
export function browserAuth(clientId: string): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let server: Server | null = null
    const done = (err: Error | null, data?: { code: string; redirectUri: string }): void => {
      try {
        server?.close()
      } catch {
        /* ignore */
      }
      if (err) reject(err)
      else if (data) resolve(data)
    }

    server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('not found')
        return
      }
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><title>RAINBOW MC</title>` +
          `<body style="background:#0a1018;color:#e9f1fb;font-family:system-ui;display:grid;place-items:center;height:100vh">` +
          `<div style="text-align:center"><h2>${error ? '授权失败' : '授权完成，可以关闭此页面回到 RAINBOW MC'}</h2>` +
          `<p style="color:#5c6e88">${error ?? ''}</p></div></body>`
      )
      if (error) done(new Error(error))
      else if (code) done(null, { code, redirectUri })
      else done(new Error('no code'))
    })

    let redirectUri = ''
    server.listen(0, 'localhost', () => {
      const port = (server!.address() as AddressInfo).port
      // 微软要求回环地址用 http://localhost:<任意端口>，注册时填 http://localhost 即可
      redirectUri = `http://localhost:${port}/callback`
      const url =
        `${AUTHORITY}/authorize?client_id=${encodeURIComponent(clientId)}` +
        `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(SCOPE)}&prompt=select_account`
      void shell.openExternal(url)
      setTimeout(() => done(new Error('timed out waiting for authorization')), 300000)
    })
  })
}

export async function exchangeCode(clientId: string, code: string, redirectUri: string): Promise<MsTokens> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    scope: SCOPE
  })
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: timeout(30000)
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as MsTokens
}

async function xboxLive(accessToken: string): Promise<{ token: string; uhs: string }> {
  const call = async (rps: string): Promise<Response> =>
    fetch('https://user.auth.xboxlive.com/user/authenticate', {
      method: 'POST',
      headers: { ...UA_JSON, 'x-xbl-contract-version': '1' },
      body: JSON.stringify({
        Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: rps },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT'
      }),
      signal: timeout(30000)
    })

  // 微软个人账号的令牌要带 d= 前缀；老式令牌不带前缀，401 时自动换一种试
  let res = await call(`d=${accessToken}`)
  if (res.status === 401) {
    const alt = await call(accessToken)
    if (alt.ok) res = alt
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let detail = body.slice(0, 300)
    try {
      const j = JSON.parse(body) as { XErr?: number; Message?: string }
      if (j.XErr) detail = `XErr=${j.XErr} ${j.Message || ''}`
    } catch {
      /* ignore */
    }
    throw new Error(`Xbox Live 认证失败（HTTP ${res.status}）：${detail}`)
  }
  const data = (await res.json()) as { Token: string; DisplayClaims: { xui: { uhs: string }[] } }
  return { token: data.Token, uhs: data.DisplayClaims.xui[0].uhs }
}

async function xsts(xblToken: string): Promise<{ token: string; uhs: string }> {
  const res = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: UA_JSON,
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    }),
    signal: timeout(30000)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`xsts failed: ${res.status} ${text}`)
  }
  const data = (await res.json()) as { Token: string; DisplayClaims: { xui: { uhs: string }[] } }
  return { token: data.Token, uhs: data.DisplayClaims.xui[0].uhs }
}

async function minecraftLogin(xstsToken: string, uhs: string): Promise<string> {
  const res = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: UA_JSON,
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xstsToken}` }),
    signal: timeout(30000)
  })
  if (!res.ok) throw new Error(`minecraft login failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

export async function fetchProfile(mcToken: string): Promise<MsProfile> {
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mcToken}`, Accept: 'application/json' },
    signal: timeout(30000)
  })
  if (res.status === 404) throw new Error('该微软账号没有 Minecraft Java 版所有权')
  if (!res.ok) throw new Error(`profile failed: ${res.status}`)
  return (await res.json()) as MsProfile
}

/** 完整微软登录链：授权码 → 微软 token → Xbox Live → XSTS → Minecraft */
export async function microsoftLogin(clientId: string): Promise<AccountInfo> {
  if (!clientId) throw new Error('未配置 client_id')
  const { code, redirectUri } = await browserAuth(clientId)
  const tokens = await exchangeCode(clientId, code, redirectUri)
  const xbl = await xboxLive(tokens.access_token)
  const x = await xsts(xbl.token)
  const mcToken = await minecraftLogin(x.token, x.uhs)
  const profile = await fetchProfile(mcToken)

  return {
    id: 'ms-' + profile.id,
    name: profile.name,
    uuid: profile.id.replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
      '$1-$2-$3-$4-$5'
    ),
    mode: 'microsoft',
    accessToken: mcToken,
    avatar: profile.skins?.[0]?.url,
    createdAt: Date.now()
  }
}

/**
 * 设备代码流（PCL2 同款做法）：
 * 不需要重定向 URI、不需要本地端口，只在浏览器输入一个代码。
 */
export async function microsoftLoginDevice(
  clientId: string,
  onCode: (userCode: string, verificationUri: string, expiresIn: number) => void
): Promise<AccountInfo> {
  if (!clientId) throw new Error('未配置 client_id')

  const devRes = await fetch(`${AUTHORITY}/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, tenant: '/consumers', scope: SCOPE }),
    signal: timeout(30000)
  })
  if (!devRes.ok) {
    const txt = await devRes.text()
    throw new Error(`设备代码申请失败：${devRes.status} ${txt.slice(0, 200)}`)
  }
  const dev = (await devRes.json()) as {
    user_code: string
    device_code: string
    verification_uri: string
    expires_in: number
    interval?: number
  }
  onCode(dev.user_code, dev.verification_uri, dev.expires_in)
  void shell.openExternal(dev.verification_uri)

  const intervalMs = Math.max(3, dev.interval ?? 5) * 1000
  const deadline = Date.now() + dev.expires_in * 1000
  let tokens: MsTokens | null = null
  while (Date.now() < deadline) {
    await sleepMs(intervalMs)
    const res = await fetch(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: dev.device_code
      }),
      signal: timeout(30000)
    })
    if (res.ok) {
      tokens = (await res.json()) as MsTokens
      break
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (body.error === 'authorization_pending') continue
    if (body.error === 'slow_down') {
      await sleepMs(2000)
      continue
    }
    if (body.error === 'expired_token') throw new Error('设备代码已过期，请重新登录')
    if (body.error === 'authorization_declined') throw new Error('你在浏览器里取消了授权')
    throw new Error(`登录失败：${body.error || res.status}`)
  }
  if (!tokens) throw new Error('等待授权超时，请重新登录')

  const xbl = await xboxLive(tokens.access_token)
  const x = await xsts(xbl.token)
  const mcToken = await minecraftLogin(x.token, x.uhs)
  const profile = await fetchProfile(mcToken)

  return {
    id: 'ms-' + profile.id,
    name: profile.name,
    uuid: profile.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'),
    mode: 'microsoft',
    accessToken: mcToken,
    avatar: profile.skins?.[0]?.url,
    createdAt: Date.now()
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function isLikelyClientId(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim())
}

/* ══════════════════════════════════════════════════════════════════════
   公开客户端 ID 模式（live.com 设备码）
   ⚠ 用的是微软官方启动器内置的公共 client_id（00000000402b5328），
   不需要 Azure 账号、不需要注册应用。属于冒用官方客户端身份，
   有被微软拉黑/连带影响账号的风险，默认不启用。
   ══════════════════════════════════════════════════════════════════════ */
export const PUBLIC_CLIENT_ID = '00000000402b5328'
const LIVE_CONNECT = 'https://login.live.com/oauth20_connect.srf'
const LIVE_TOKEN = 'https://login.live.com/oauth20_token.srf'
const LIVE_SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL'

export async function microsoftLoginPublic(
  onCode: (userCode: string, verificationUri: string, expiresIn: number) => void
): Promise<AccountInfo> {
  const res = await fetch(LIVE_CONNECT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: PUBLIC_CLIENT_ID,
      scope: LIVE_SCOPE,
      response_type: 'device_code'
    }),
    signal: AbortSignal.timeout(30000)
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`设备代码申请失败：${res.status} ${t.slice(0, 200)}`)
  }
  const dev = (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval?: number
  }
  onCode(dev.user_code, dev.verification_uri, dev.expires_in)
  void shell.openExternal(dev.verification_uri)

  const intervalMs = Math.max(3, dev.interval ?? 5) * 1000
  const deadline = Date.now() + dev.expires_in * 1000
  let token: { access_token?: string; error?: string; error_description?: string } | null = null
  while (Date.now() < deadline) {
    await sleepMs(intervalMs)
    const r = await fetch(LIVE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: PUBLIC_CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: dev.device_code
      }),
      signal: AbortSignal.timeout(30000)
    })
    const body = (await r.json().catch(() => ({}))) as {
      access_token?: string
      error?: string
      error_description?: string
    }
    if (r.ok && body.access_token) {
      token = body
      break
    }
    if (body.error === 'authorization_pending' || body.error === 'slow_down') continue
    if (body.error === 'expired_token') throw new Error('设备代码已过期，请重新登录')
    if (body.error === 'authorization_declined') throw new Error('你在浏览器里取消了授权')
    throw new Error(`登录失败：${body.error_description || body.error || r.status}`)
  }
  if (!token?.access_token) throw new Error('等待授权超时，请重新登录')

  const xbl = await xboxLive(token.access_token)
  const x = await xsts(xbl.token)
  const mcToken = await minecraftLogin(x.token, x.uhs)
  const profile = await fetchProfile(mcToken)

  return {
    id: 'ms-' + profile.id,
    name: profile.name,
    uuid: profile.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'),
    mode: 'microsoft',
    accessToken: mcToken,
    avatar: profile.skins?.[0]?.url,
    createdAt: Date.now()
  }
}