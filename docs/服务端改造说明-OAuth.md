# RAINBOW MC 启动器 · 服务端改造说明（OAuth 授权登录）

> **读者：负责 rainbowdoor.icu 网站服务端的开发者 / AI**
> **目标：把现在的「账号密码接口」改造成「网页 OAuth 授权（Authorization Code + PKCE）」**
> 客户端（Electron 启动器）**已经按本文档实现完毕**，服务端照此改完即可直接联调。
>
> 文档版本：v1.0 · 2026-10-21 · 对应启动器 `app/src/main/minecraft/club.ts`

---

## 0. 一句话概括

用户点「社团账号登录」→ 启动器打开浏览器 → 用户在**你的网站**登录并点「同意授权」→ 浏览器回跳
`http://127.0.0.1:47913/callback?code=...&state=...` → 启动器用 `code + code_verifier` 换 `access_token`
→ 再用 token 调 `/api/sso/userinfo` 拿用户信息。

**密码只在你的网站上输入，永远不经过启动器。**

---

## 1. 现状与要改的东西

| 现状 | 改造成 |
|---|---|
| `POST /api/sso/launcher-auth`（账号密码直传） | **废弃**，保留但返回 `410 Gone` |
| 无授权页 | **新增** `GET /sso/authorize`（网页） |
| 无 token 接口 | **新增** `POST /api/sso/token` |
| 无用户信息接口 | **新增** `GET /api/sso/userinfo` |

> 客户端仍然兼容旧密码接口存在（不会调用它），但**新的登录流程只走 OAuth**。

---

## 2. 客户端固定参数（服务端必须按此校验）

| 参数 | 值 |
|---|---|
| `client_id` | `rainbow-mc` |
| `redirect_uri` | `http://127.0.0.1:47913/callback` |
| `response_type` | `code` |
| `scope` | `profile` |
| `code_challenge_method` | `S256` |
| 用户信息字段 | `id`、`nickname`（或 `name`）、`email`、`avatar`、`role` |

**`redirect_uri` 必须精确匹配**：协议、主机（`127.0.0.1` 而非 `localhost`）、端口 `47913`、路径 `/callback`，任一不同都必须拒绝。

---

## 3. 接口一：授权页 `GET /sso/authorize`

### 请求示例

```
GET /sso/authorize
  ?client_id=rainbow-mc
  &redirect_uri=http%3A%2F%2F127.0.0.1%3A47913%2Fcallback
  &response_type=code
  &scope=profile
  &state=<32字符随机串>
  &code_challenge=<43字符base64url>
  &code_challenge_method=S256
  &launcher=RAINBOW+MC
  &launcher_version=0.1.0
```

### 服务端处理顺序

1. **校验 client_id** 是否已登记（`sso_clients` 表），未登记 → 400 + 错误页（`E9103`）
2. **校验 redirect_uri** 是否在该 client 的允许列表里，不在 → 400，**绝对不要跳转**（防开放重定向）
3. **校验 response_type === 'code'**、`code_challenge_method === 'S256'`、`code_challenge` 长度 ≥ 43
4. 用户未登录 → 302 到登录页，登录后**回到本授权页**（保留全部 query）
5. 渲染授权页，显示：
   > **RAINBOW MC 请求访问你的账号**
   > 昵称、邮箱、头像
   > [ 同意授权 ]  [ 取消 ]
6. 用户点「同意」：
   - 生成 32 字节随机 `code`（hex 或 base64url，64 字符以内）
   - 写入 `sso_codes`：`code`、`client_id`、`user_id`、`code_challenge`、`redirect_uri`、`expires_at = now + 5min`、`used_at = NULL`
   - 302 跳 `{redirect_uri}?code=<code>&state=<原样state>`
7. 用户点「取消」：
   - 302 跳 `{redirect_uri}?error=access_denied&state=<原样state>`
8. **`state` 必须原样带回**，否则客户端会拒绝处理这个回调

### 关键安全点

- `code` **一次性**：换过 token 后立刻 `used_at = now`，再用一律拒绝（`E9104`）
- `code` **5 分钟**过期
- `code` 必须与 `client_id` + `redirect_uri` 同时绑定，校验不符拒绝
- 授权页要带 CSRF 保护（你自己的 session token 即可）

---

## 4. 接口二：换令牌 `POST /api/sso/token`

### 请求

```
POST https://rainbowdoor.icu/api/sso/token
Content-Type: application/json
```

```json
{
  "grant_type": "authorization_code",
  "client_id": "rainbow-mc",
  "code": "回调里拿到的code",
  "redirect_uri": "http://127.0.0.1:47913/callback",
  "code_verifier": "客户端生成的原始 verifier（43~128 字符）"
}
```

### 服务端校验顺序

1. `grant_type` 必须是 `authorization_code`（或 `refresh_token`）
2. 按 `code` 查 `sso_codes`：
   - 不存在 → `E9104`
   - 已使用（`used_at` 非空）→ `E9104`
   - 已过期 → `E9104`
   - `client_id` / `redirect_uri` 不匹配 → `E9104`
3. **PKCE 校验**：`base64url(sha256(code_verifier)) === code_challenge`，不符 → `E9104`
   （Node 示例：`crypto.createHash('sha256').update(verifier).digest('base64url')`）
4. 标记 `used_at = now`
5. 生成令牌：
   - `access_token`：32 字节随机，**数据库只存 sha256 哈希**
   - `refresh_token`：32 字节随机，同样只存哈希
   - `access_token` 有效期 **7200 秒**，`refresh_token` **2592000 秒（30 天）**
6. 写 `sso_tokens` 表

### 成功响应（HTTP 200）

```json
{
  "ok": true,
  "access_token": "db386728776c03a38155c6eb2de3e518555dad8a601c8588a1a9938582aea1cd",
  "refresh_token": "c1a9e0f2b7d34e58a6f90c2d1e7b8a45d3f2e1c0b9a8d7e6f5c4b3a2918776655",
  "token_type": "Bearer",
  "expires_in": 7200,
  "scope": "profile",
  "user": {
    "id": "b16232f9-7138-4b1e-8ed6-a670f2710ecf",
    "name": "鸽子",
    "nickname": "鸽子",
    "email": "nw202408@qq.com",
    "avatar": null,
    "role": "user"
  }
}
```

> `user` 字段可选（客户端换完 token 会再调一次 `/userinfo`），但建议返回，省一次请求。

### 刷新令牌（同接口）

```json
{ "grant_type": "refresh_token", "client_id": "rainbow-mc", "refresh_token": "..." }
```

- 校验 `refresh_token` 哈希存在、未过期、未被撤销
- 可选：**轮换**（发新 refresh_token，旧的置 `revoked_at`）—— 推荐开启
- 返回结构与上面相同

### 失败响应

HTTP 400/401 均可，**body 必须是 JSON**：

```json
{ "ok": false, "error": "invalid_grant", "error_description": "授权码已过期，请重新授权" }
```

客户端识别 `access_token` 是否存在 + `error` / `error_description` 字段。

---

## 5. 接口三：用户信息 / 校验令牌 `GET /api/sso/userinfo`

**这个接口最重要**：启动器**每次启动游戏前**都会调它，用来判断账号是否还有效。

### 请求

```
GET https://rainbowdoor.icu/api/sso/userinfo
Authorization: Bearer <access_token>
```

### 成功（HTTP 200）

```json
{
  "sub": "b16232f9-7138-4b1e-8ed6-a670f2710ecf",
  "id": "b16232f9-7138-4b1e-8ed6-a670f2710ecf",
  "email": "nw202408@qq.com",
  "nickname": "鸽子",
  "avatar": null,
  "role": "user",
  "client_id": "rainbow-mc",
  "scope": "profile"
}
```

- `id` 或 `sub` **必须至少有一个**（客户端用它绑定账号）
- `nickname` 缺失时客户端回退到 `name`，再回退到 `email`

### 失败（必须返回真实状态码，不能是 200）

| 情况 | 状态码 | body |
|---|---|---|
| 缺 Authorization / 格式错 | **401** | `{ "error": "invalid_token", "error_description": "缺少访问令牌" }` |
| 令牌不存在/过期/已撤销 | **401** | `{ "error": "invalid_token", "error_description": "登录已失效，请重新登录" }` |
| 账号被封禁 | **403** | `{ "error": "forbidden", "error_description": "该账号已被封禁" }` |
| 被限制应用授权 | **403** | `{ "error": "restricted", "error_description": "该账号已被限制应用授权" }` |

> **注意**：很多实现习惯所有接口都返回 200 + `ok:false`，但 `/userinfo` **不能这样**——客户端靠状态码区分「登录失效」和「被封禁」。401 = 提示重新登录；403 = 提示联系管理员。

---

## 6. 数据库表（建表参考）

```sql
-- 已登记的客户端（启动器）
CREATE TABLE sso_clients (
  client_id     VARCHAR(64) PRIMARY KEY,          -- 'rainbow-mc'
  name          VARCHAR(120) NOT NULL,
  client_type   VARCHAR(20) DEFAULT 'public',     -- 公共客户端，无 client_secret
  redirect_uris TEXT NOT NULL,                    -- JSON 数组，精确匹配
  allowed_scopes VARCHAR(200) DEFAULT 'profile',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 授权码（一次性）
CREATE TABLE sso_codes (
  code           VARCHAR(80) PRIMARY KEY,
  client_id      VARCHAR(64) NOT NULL,
  user_id        VARCHAR(64) NOT NULL,
  code_challenge VARCHAR(128) NOT NULL,
  redirect_uri   VARCHAR(255) NOT NULL,
  scope          VARCHAR(120) DEFAULT 'profile',
  expires_at     DATETIME NOT NULL,               -- now + 5min
  used_at        DATETIME NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_codes_user (user_id)
);

-- 令牌（只存哈希）
CREATE TABLE sso_tokens (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  access_hash    CHAR(64) NOT NULL,               -- sha256(access_token)
  refresh_hash   CHAR(64) NOT NULL,               -- sha256(refresh_token)
  client_id      VARCHAR(64) NOT NULL,
  user_id        VARCHAR(64) NOT NULL,
  scope          VARCHAR(120) DEFAULT 'profile',
  access_expires_at  DATETIME NOT NULL,
  refresh_expires_at DATETIME NOT NULL,
  revoked_at     DATETIME NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_access (access_hash),
  UNIQUE KEY uk_refresh (refresh_hash),
  INDEX idx_user (user_id)
);

-- 审计日志（出问题靠它查）
CREATE TABLE sso_audit_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(64),
  client_id   VARCHAR(64),
  action      VARCHAR(40),      -- authorize_ok / authorize_denied / token_issued / token_revoked / userinfo_ok / userinfo_401
  ip          VARCHAR(64),
  user_agent  VARCHAR(255),
  launcher_version VARCHAR(40),
  detail      VARCHAR(255),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 初始化客户端（按你的真实域名改）
INSERT INTO sso_clients (client_id, name, redirect_uris, allowed_scopes)
VALUES ('rainbow-mc', 'RAINBOW MC 启动器', '["http://127.0.0.1:47913/callback"]', 'profile');
```

---

## 7. 参考实现（Express 风格，可直接改用）

```js
const crypto = require('crypto')
const express = require('express')
const router = express.Router()

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const rand = (n = 32) => crypto.randomBytes(n).toString('hex')

// ── 授权页 ─────────────────────────────────────────────
router.get('/sso/authorize', async (req, res) => {
  const { client_id, redirect_uri, response_type, state, code_challenge, code_challenge_method, scope } = req.query

  const client = await db.getClient(client_id)
  if (!client) return res.status(400).send('客户端未登记')
  const allowed = JSON.parse(client.redirect_uris)
  if (!allowed.includes(redirect_uri)) return res.status(400).send('redirect_uri 不允许')
  if (response_type !== 'code') return res.status(400).send('response_type 必须是 code')
  if (code_challenge_method !== 'S256' || !code_challenge) return res.status(400).send('缺少 PKCE')

  const user = await getSessionUser(req)
  if (!user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl))

  // 已授权过就直接发 code（可选优化）
  res.render('authorize', { user, clientName: client.name, state, query: req.query })
})

// 用户点「同意」
router.post('/sso/authorize', async (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, decision } = req.body
  const user = await getSessionUser(req)
  if (!user) return res.status(401).send('未登录')

  if (decision !== 'allow') {
    return res.redirect(`${redirect_uri}?error=access_denied&state=${encodeURIComponent(state)}`)
  }

  const code = rand(32)
  await db.insertCode({
    code,
    client_id,
    user_id: user.id,
    code_challenge,
    redirect_uri,
    expires_at: new Date(Date.now() + 5 * 60 * 1000)
  })
  await audit(user.id, client_id, 'authorize_ok', req)
  res.redirect(`${redirect_uri}?code=${code}&state=${encodeURIComponent(state)}`)
})

// ── 换令牌 ─────────────────────────────────────────────
router.post('/api/sso/token', async (req, res) => {
  const { grant_type, client_id, code, redirect_uri, code_verifier, refresh_token } = req.body

  if (grant_type === 'authorization_code') {
    const row = await db.getCode(code)
    if (!row || row.used_at || row.expires_at < new Date()) {
      return res.status(400).json({ ok: false, error: 'invalid_grant', error_description: '授权码无效或已过期' })
    }
    if (row.client_id !== client_id || row.redirect_uri !== redirect_uri) {
      return res.status(400).json({ ok: false, error: 'invalid_grant', error_description: '参数不匹配' })
    }
    const challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url')
    if (challenge !== row.code_challenge) {
      return res.status(400).json({ ok: false, error: 'invalid_grant', error_description: 'PKCE 校验失败' })
    }
    await db.markCodeUsed(code)

    const access = rand(32)
    const refresh = rand(32)
    await db.insertToken({
      access_hash: sha256(access),
      refresh_hash: sha256(refresh),
      client_id,
      user_id: row.user_id,
      access_expires_at: new Date(Date.now() + 2 * 3600 * 1000),
      refresh_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000)
    })
    const user = await db.getUser(row.user_id)
    return res.json({
      ok: true,
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: 7200,
      scope: 'profile',
      user: { id: user.id, name: user.nickname, nickname: user.nickname, email: user.email, avatar: user.avatar, role: user.role }
    })
  }

  if (grant_type === 'refresh_token') {
    const t = await db.getTokenByRefresh(sha256(refresh_token))
    if (!t || t.revoked_at || t.refresh_expires_at < new Date()) {
      return res.status(400).json({ ok: false, error: 'invalid_grant', error_description: '刷新令牌无效' })
    }
    const access = rand(32)
    await db.rotateAccess(t.id, sha256(access), new Date(Date.now() + 2 * 3600 * 1000))
    return res.json({ ok: true, access_token: access, token_type: 'Bearer', expires_in: 7200 })
  }

  res.status(400).json({ ok: false, error: 'unsupported_grant_type' })
})

// ── 用户信息 + 校验 ────────────────────────────────────
router.get('/api/sso/userinfo', async (req, res) => {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'invalid_token', error_description: '缺少访问令牌' })

  const t = await db.getTokenByAccess(sha256(token))
  if (!t || t.revoked_at || t.access_expires_at < new Date()) {
    return res.status(401).json({ error: 'invalid_token', error_description: '登录已失效，请重新登录' })
  }
  const user = await db.getUser(t.user_id)
  if (!user) return res.status(401).json({ error: 'invalid_token', error_description: '用户不存在' })
  if (user.banned) return res.status(403).json({ error: 'forbidden', error_description: '该账号已被封禁' })
  if (user.auth_restricted) return res.status(403).json({ error: 'restricted', error_description: '该账号已被限制应用授权' })

  res.json({
    sub: user.id, id: user.id, email: user.email, nickname: user.nickname,
    avatar: user.avatar, role: user.role, client_id: t.client_id, scope: t.scope
  })
})

// ── 旧密码接口废弃 ─────────────────────────────────────
router.post('/api/sso/launcher-auth', (req, res) => {
  res.status(410).json({ ok: false, code: 'E9100', message: '该接口已废弃，请升级到最新版启动器' })
})
```

> 上面用了 `digest('base64url')`（Node 16+ 支持）。如果你的 Node 版本较老，用：
> `digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')`

---

## 8. 错误码约定

| code | 含义 | 客户端表现 |
|---|---|---|
| `E9101` | 缺少必填参数 | 提示参数问题 |
| `E9102` | 参数格式错误 | 同上 |
| `E9103` | client_id 未登记 | 「启动器客户端尚未在网站登记，请联系管理员」，不重试 |
| `E9104` | code 无效/已用/过期/PKCE 不符 | 「请重新授权」 |
| `E9105` | 账号被封禁 | 「该账号已被封禁」 |
| `E9106` | 账号被限制应用授权 | 提示联系管理员 |
| `access_denied` | 用户点了取消 | 「你在网站上取消了授权」 |
| `E9110` | 客户端本地：等待超时（5 分钟） | 提示重新授权 |
| `E9111` | 客户端本地：取消/端口占用/state 不匹配 | 按提示处理 |
| `E9199` | 服务器内部错误 | 允许重试一次 |

**服务器内部错误也要返回 JSON**，不要把 HTML 错误页丢给客户端（客户端会报 `E9006 返回的不是 JSON`）。

---

## 9. 联调自测清单

### ① 授权页能否打开（不用启动器）

浏览器直接访问：

```
https://rainbowdoor.icu/sso/authorize?client_id=rainbow-mc&redirect_uri=http%3A%2F%2F127.0.0.1%3A47913%2Fcallback&response_type=code&scope=profile&state=teststate&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256
```

预期：显示授权页；点「同意」后跳
`http://127.0.0.1:47913/callback?code=xxx&state=teststate`
（浏览器会显示“无法访问”，正常——47913 只有启动器在跑时才监听）

### ② 换 token

```bash
curl -s -X POST https://rainbowdoor.icu/api/sso/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"authorization_code","client_id":"rainbow-mc","code":"<上面的code>","redirect_uri":"http://127.0.0.1:47913/callback","code_verifier":"<生成该challenge对应的原始verifier>"}'
```

预期：`{"ok":true,"access_token":"...","refresh_token":"...","expires_in":7200,...}`

### ③ 取用户信息

```bash
curl -s -H "Authorization: Bearer <access_token>" https://rainbowdoor.icu/api/sso/userinfo
```

预期：`{"id":"...","nickname":"...",...}`

### ④ 错误场景（必须都测）

```bash
# 重复使用同一个 code → 必须 400 + E9104
# 错误 code_verifier → 必须 400 + E9104
# 不带 Authorization → 必须 401
# 乱写 token → 必须 401
# 被封禁账号的 token → 必须 403
```

### ⑤ 启动器端

1. 启动器「设置 → 社团授权」确认 `baseUrl = https://rainbowdoor.icu`，模拟模式关闭
2. 点「社团账号登录」→ 填游戏内昵称 → 点授权
3. 浏览器授权完成后，启动器应自动建号并解锁主界面
4. 点「启动游戏」→ 内部会再调一次 `/userinfo`；若返回 401，启动会被终止并提示重新登录

---

## 10. 验收标准（逐条打勾）

- [ ] `GET /sso/authorize` 能正常渲染，未登录会引导登录
- [ ] `redirect_uri` 不在白名单时**不跳转**（返回 400）
- [ ] `state` 原样带回
- [ ] 同意后跳 `127.0.0.1:47913/callback?code=&state=`
- [ ] 取消后跳 `...?error=access_denied&state=`
- [ ] `POST /api/sso/token` PKCE 校验生效（verifier 错误 → 400）
- [ ] code 只能用一次、5 分钟过期
- [ ] `GET /api/sso/userinfo` 401/403 语义正确
- [ ] 旧 `/api/sso/launcher-auth` 返回 410
- [ ] 所有错误返回 JSON（不是 HTML）
- [ ] 审计日志记录了授权、发令牌、校验失败

---

## 11. 常见坑（服务端侧）

| 坑 | 后果 |
|---|---|
| `redirect_uri` 写成 `localhost` | 客户端用 `127.0.0.1`，精确匹配失败，授权直接挂了 |
| 忘记 `state` | 客户端判为 CSRF，回调被拒绝（`E9111`） |
| `code_challenge` 用 `plain` | 客户端固定 S256，校验必然失败 |
| userinfo 全部返回 200 | 客户端无法区分「失效」和「封禁」 |
| 令牌明文入库 | 数据库泄露 = 全员被盗 |
| 没做限流 | 可被刷 code / 刷 token |
| 返回 HTML 错误页 | 客户端解析失败，用户看到 `E9006` |
| 授权页没有登录态检查 | 用户可能给别人的账号授权 |

---

## 12. 需要你回过来确认的三件事

1. `redirect_uri` 白名单是否就按 `http://127.0.0.1:47913/callback`（**字面量，用 127.0.0.1**）
2. `access_token` 2 小时 / `refresh_token` 30 天，是否接受
3. 授权页上「取消」按钮的文案，我这边客户端显示的是「你在网站上取消了授权」
