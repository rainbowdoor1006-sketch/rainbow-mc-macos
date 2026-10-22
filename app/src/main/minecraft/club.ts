import { createServer, type Server } from 'http'
import { randomBytes, createHash } from 'crypto'
import { shell } from 'electron'
import type { AppSettings } from '@shared/types'

export interface ClubUser {
  id: string
  name: string
  avatar?: string
  email?: string
}

export interface ClubAuthResult {
  ok: boolean
  user?: ClubUser
  token?: string
  /** 令牌有效期（秒），服务端固定 30 天 = 2592000 */
  expiresIn?: number
  message?: string
  errorCode?: string
}

export interface ClubVerifyResult {
  ok: boolean
  userId?: string
  userName?: string
  avatar?: string
  message?: string
  errorCode?: string
}

/**
 * 校验社团令牌是否仍然有效（每次启动游戏前都要调）。
 * GET {baseUrl}/api/sso/userinfo  Authorization: Bearer <token>
 * 401 = 令牌失效/被撤销；403 = 被封禁。
 */
export async function clubVerify(settings: AppSettings, token: string): Promise<ClubVerifyResult> {
  if (!token) return { ok: false, errorCode: 'E9010', message: '没有社团登录凭证，请重新登录' }
  const base = settings.clubApi.baseUrl.replace(/\/$/, '')
  if (!base) return { ok: false, errorCode: 'E9010', message: '社团接口未配置' }

  try {
    const res = await fetch(`${base}/api/sso/userinfo`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    })
    const text = await res.text()
    let data: {
      id?: string
      sub?: string
      nickname?: string
      name?: string
      email?: string
      avatar?: string | null
      error?: string
      error_description?: string
    } = {}
    try {
      data = JSON.parse(text) as typeof data
    } catch {
      return { ok: false, errorCode: 'E9006', message: `社团接口返回的不是 JSON（HTTP ${res.status}）` }
    }

    if (res.status === 401) {
      return { ok: false, errorCode: 'E9011', message: data.error_description || '社团登录已失效，请重新登录' }
    }
    if (res.status === 403) {
      // 服务端用 error 字段区分：account_banned（封禁）/ restricted（限制授权）
      if (data.error === 'restricted') {
        return { ok: false, errorCode: 'E9016', message: '该社团账号已被限制应用授权，请联系管理员' }
      }
      return { ok: false, errorCode: 'E9012', message: '该社团账号已被封禁，请联系管理员' }
    }
    if (!res.ok) {
      return { ok: false, errorCode: `HTTP${res.status}`, message: data.error_description || `校验失败（HTTP ${res.status}）` }
    }
    const id = data.id || data.sub
    if (!id) return { ok: false, errorCode: 'E9007', message: '社团接口返回缺少用户 id' }
    return {
      ok: true,
      userId: id,
      userName: data.nickname || data.name || data.email || id,
      avatar: absolutize(data.avatar || '', base)
    }
  } catch (e) {
    return { ok: false, errorCode: 'E9008', message: `连不上社团接口：${e instanceof Error ? e.message : String(e)}` }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   社团账号授权 —— 浏览器跳转版（OAuth2 授权码 + PKCE）
   2026-10-20 改造：从「启动器里填账号密码」改为「跳浏览器授权」，
   与 RAIN VPN Work 2、RAINBOW 材料助手保持同一套 SSO 流程。

   流程：
     ① 在 127.0.0.1:47913 起一个临时 HTTP 服务
     ② 打开系统浏览器到 https://rainbowdoor.icu/sso/authorize?...
     ③ 用户在网站上登录并点「同意授权」
     ④ 网站回跳 http://127.0.0.1:47913/callback?code=...&state=...
     ⑤ 启动器拿 code + code_verifier 换 token（POST /api/sso/token）
     ⑥ 用 token 取用户信息（GET /api/sso/userinfo）
     ⑦ 关掉临时服务，返回 ClubUser

   ⚠ 回调端口必须和网站登记的 redirect_uri 完全一致：
        http://127.0.0.1:47913/callback
     改端口必须同时在网站后台改 sso_clients.redirect_uris。
   ══════════════════════════════════════════════════════════════════════ */

const CLIENT_ID = 'rainbow-mc'
const CALLBACK_PORT = 47913
const CALLBACK_PATH = '/callback'
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`
const LAUNCHER_NAME = 'RAINBOW MC'
const LAUNCHER_VERSION = require('electron').app.getVersion()
const AUTHORIZE_TIMEOUT_MS = 5 * 60 * 1000

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function callbackHtml(title: string, detail: string, ok: boolean): string {
  const color = ok ? '#7FB69B' : '#E06C75'
  return (
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + title + '</title></head>' +
    '<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;' +
    'background:#0B0C0E;color:#E6E6E6;display:flex;align-items:center;justify-content:center;height:100vh;">' +
    '<div style="text-align:center;max-width:420px;padding:0 24px;">' +
    '<div style="width:56px;height:56px;border-radius:14px;background:#121416;border:1px solid #23262A;' +
    'display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:26px;color:' + color + ';">' +
    (ok ? '✓' : '!') + '</div>' +
    '<h2 style="margin:0 0 10px;font-size:19px;font-weight:600;color:' + color + ';">' + title + '</h2>' +
    '<p style="margin:0;font-size:13px;line-height:1.7;color:#8A8F98;">' + detail + '</p>' +
    '<p style="margin:22px 0 0;font-size:12px;color:#5C626B;">可以关闭此页面，回到 RAINBOW MC</p>' +
    '</div></body></html>'
  )
}

type CallbackResult = { code?: string; error?: string; errorDescription?: string }

/** 起临时回调服务，等网站把 code 送回来 */
function waitForCallback(state: string): { promise: Promise<CallbackResult>; close: () => void } {
  let server: Server | null = null
  let settle: ((v: CallbackResult) => void) | null = null
  let settled = false

  const finish = (v: CallbackResult): void => {
    if (settled) return
    settled = true
    settle?.(v)
  }

  const promise = new Promise<CallbackResult>((resolve) => {
    settle = resolve
    server = createServer((req, res) => {
      const url = new URL(req.url || '/', REDIRECT_URI)
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }

      const code = url.searchParams.get('code') || ''
      const err = url.searchParams.get('error') || ''
      const gotState = url.searchParams.get('state') || ''

      if (gotState && gotState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(callbackHtml('授权失败', 'state 校验不通过，请回到启动器重新授权。', false))
        finish({ error: 'state_mismatch' })
        return
      }

      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(callbackHtml('已取消授权', '你在网站上取消了本次授权。', false))
        finish({ error: err, errorDescription: url.searchParams.get('error_description') || '' })
        return
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(callbackHtml('授权失败', '没有拿到授权码。', false))
        finish({ error: 'no_code' })
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(callbackHtml('授权完成', '社团账号已通过验证，可以回到启动器继续。', true))
      finish({ code })
    })

    server.on('error', (e: NodeJS.ErrnoException) => {
      finish({
        error: e.code === 'EADDRINUSE' ? 'port_in_use' : 'server_error',
        errorDescription: e.message
      })
    })

    server.listen(CALLBACK_PORT, '127.0.0.1')
  })

  return {
    promise,
    close: () => {
      try {
        server?.close()
      } catch {
        /* ignore */
      }
      server = null
    }
  }
}

/**
 * 让用户通过浏览器授权社团账号。
 * 成功后返回 { ok:true, token, user }；失败返回 { ok:false, errorCode, message }。
 */
export async function clubAuthorize(settings: AppSettings): Promise<ClubAuthResult> {
  const { clubApi } = settings

  // 本地模拟模式：接口未对接时使用（正式版 mockMode = false）
  if (clubApi.mockMode) {
    return {
      ok: true,
      user: { id: 'mock-club-user', name: '本地模拟用户' },
      token: 'mock-token'
    }
  }

  const site = (clubApi.baseUrl || 'https://rainbowdoor.icu').replace(/\/$/, '')
  const { verifier, challenge } = makePkce()
  const state = b64url(randomBytes(16))
  const cb = waitForCallback(state)

  const authUrl =
    `${site}/sso/authorize?` +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      launcher: LAUNCHER_NAME,
      launcher_version: LAUNCHER_VERSION
    }).toString()

  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<CallbackResult>((resolve) => {
    timer = setTimeout(() => resolve({ error: 'timeout' }), AUTHORIZE_TIMEOUT_MS)
  })

  try {
    await shell.openExternal(authUrl)
  } catch (e) {
    cb.close()
    return {
      ok: false,
      errorCode: 'E9005',
      message: `打不开浏览器：${e instanceof Error ? e.message : String(e)}`
    }
  }

  const got = await Promise.race([cb.promise, timeout])
  if (timer) clearTimeout(timer)
  cb.close()

  if (!got.code) {
    const key = got.error || 'unknown'
    const map: Record<string, string> = {
      timeout: '等待授权超时（5 分钟），请重新点「授权并登录」',
      access_denied: '你在网站上取消了授权',
      state_mismatch: '授权校验失败（state 不匹配），请重试',
      port_in_use: `本地端口 ${CALLBACK_PORT} 被占用，请关掉占用它的程序后重试`,
      no_code: '没有拿到授权码，请重试'
    }
    return {
      ok: false,
      errorCode: key === 'timeout' ? 'E9110' : 'E9111',
      message: map[key] || `授权失败：${key}`
    }
  }

  // 用 code 换 token
  try {
    const tokenRes = await fetch(`${site}/api/sso/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: got.code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier
      }),
      signal: AbortSignal.timeout(20000)
    })

    const tokenText = await tokenRes.text()
    let tokenData: {
      access_token?: string
      token_type?: string
      expires_in?: number
      error?: string
      error_description?: string
      user?: {
        id?: string
        name?: string
        nickname?: string
        email?: string
        avatar?: string | null
        role?: string
      }
    } = {}
    try {
      tokenData = JSON.parse(tokenText)
    } catch {
      return {
        ok: false,
        errorCode: 'E9006',
        message: `换取令牌失败（HTTP ${tokenRes.status}）：${tokenText.slice(0, 120)}`
      }
    }

    if (!tokenData.access_token) {
      return {
        ok: false,
        errorCode: tokenData.error || `HTTP${tokenRes.status}`,
        message: tokenData.error_description || '换取令牌失败，请重新授权'
      }
    }

    // 服务端 2026-10-21 起 /token 响应已带 user，可直接用；没有再回退到 /userinfo
    const tu = tokenData.user
    let userId = tu?.id || ''
    let userName = tu?.nickname || tu?.name || ''
    let avatar = tu?.avatar || ''
    let email = tu?.email || ''

    if (!userId) {
      const infoRes = await fetch(`${site}/api/sso/userinfo`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000)
      })
      const infoText = await infoRes.text()
      let info: {
        id?: string
        sub?: string
        nickname?: string
        name?: string
        email?: string
        avatar?: string | null
        error?: string
      } = {}
      try {
        info = JSON.parse(infoText)
      } catch {
        return {
          ok: false,
          errorCode: 'E9006',
          message: `读取用户信息失败（HTTP ${infoRes.status}）：${infoText.slice(0, 120)}`
        }
      }
      if (infoRes.status === 403) {
        return {
          ok: false,
          errorCode: info.error === 'restricted' ? 'E9016' : 'E9012',
          message:
            info.error === 'restricted'
              ? '该社团账号已被限制应用授权，请联系管理员'
              : '该社团账号已被封禁'
        }
      }
      userId = info.id || info.sub || ''
      userName = info.nickname || info.name || info.email || ''
      avatar = info.avatar || ''
      email = info.email || ''
    }

    if (!userId) return { ok: false, errorCode: 'E9007', message: '社团接口返回缺少用户 id' }

    return {
      ok: true,
      token: tokenData.access_token,
      expiresIn: tokenData.expires_in || 2592000,
      user: {
        id: userId,
        name: userName || userId,
        avatar: absolutize(avatar, site),
        email
      }
    }
  } catch (e) {
    return {
      ok: false,
      errorCode: 'E9008',
      message: `连不上社团站点：${e instanceof Error ? e.message : String(e)}`
    }
  }
}

/** 服务端头像可能是相对路径（/uploads/avatars/x.jpg），补成绝对地址 */
function absolutize(u: string, site: string): string | undefined {
  if (!u) return undefined
  if (/^https?:\/\//i.test(u)) return u
  return site + (u.startsWith('/') ? u : '/' + u)
}
