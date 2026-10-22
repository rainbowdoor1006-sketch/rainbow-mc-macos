# RAINBOW MC 启动器 · 服务端回应：OAuth 流程**已经存在**，无需从零改造

> **读者：RAINBOW MC 启动器项目的开发者 / AI**
> **来源文档：`docs/服务端改造说明-OAuth.md`（v1.0）**
> **回应日期：2026-10-21**
>
> **结论先行：`/sso/authorize`、`/api/sso/token`、`/api/sso/userinfo` 这三个接口
> 在 rainbowdoor.icu 上早就做好了，而且已经在给 RAIN VPN Work 2、RAINBOW 材料助手
> 两个客户端稳定用了几个月。不需要新写。**
>
> 本文档给出**真实的**接口契约（和你的假设有出入的地方都标出来了），
> 以及我按你的文档补上的三处小改动。

---

## 0. 为什么你的文档前提不成立

`rainbowdoor.icu` 是一个已经跑起来的社团平台，SSO 子系统包含：

```
sso_clients          已登记的第三方应用（3 个）
sso_codes            授权码（一次性、5 分钟）
sso_tokens           访问令牌
sso_authorizations   授权台账（用户可在「授权管理」里撤销）
trusted_browsers     浏览器信任
audit_logs           审计日志
```

前端已有授权页 `https://rainbowdoor.icu/sso/authorize`（React 路由），
后端已有上面三个接口。**RAIN VPN Work 2 和 RAINBOW 材料助手一直在用这套。**

所以：**服务端不需要按你的文档重写。** 你只需要按本文档的真实契约对接。

---

## 1. 逐条对照：你的要求 vs 现状

| # | 你的文档要求 | 现状 | 处理 |
|---|---|---|---|
| 1 | `GET /sso/authorize` 授权页 | ✅ **已有**（React 页面，含登录态检查、浏览器信任弹窗）| 无需改 |
| 2 | `redirect_uri` 精确匹配、不在白名单**不跳转** | ✅ **已有**（`isRedirectAllowed()`，返回 400 + JSON）| 无需改 |
| 3 | `response_type=code`、`code_challenge_method=S256` 强制 | ✅ **已有**（`/api/sso/authorize/check` 会校验）| 无需改 |
| 4 | 未登录引导登录，登录后回原页面 | ✅ **已有**（React 路由 + 登录页 next 参数）| 无需改 |
| 5 | 同意 → 生成 32 字节 code，5 分钟有效 | ✅ **已有**（`CODE_TTL_MIN = 5`，`crypto.randomBytes(32).toString('hex')`）| 无需改 |
| 6 | `state` 原样带回 | ✅ **已有** | 无需改 |
| 7 | code 一次性，重复使用拒绝 | ✅ **已有**，而且做得更多 —— **检测到重放会吊销该用户在该客户端的全部令牌** | 无需改 |
| 8 | `POST /api/sso/token` + PKCE S256 校验 | ✅ **已有**（`sha256(verifier)` 与 `code_challenge` 比对）| 无需改 |
| 9 | `GET /api/sso/userinfo` 靠 401/403 区分状态 | ✅ **已有** 401（缺失/无效/过期）、403（封禁）；**限制授权原先没查，已补** | ✅ 已按你要求补 |
| 10 | `/token` 响应里回 `user` | ❌ 原来没有 | ✅ **已补** |
| 11 | 旧 `POST /api/sso/launcher-auth` 返回 410 | ⚠️ 我 10-20 刚加的账号密码接口 | ✅ **已改成 410** |
| 12 | `refresh_token`（30 天）| ❌ **不支持，也不打算加** | ❌ 不做，见 §3 |
| 13 | `access_token` 2 小时 | ⚠️ 实际 **30 天** | ❌ 不做，见 §3 |
| 14 | 令牌只存 sha256 哈希 | ⚠️ 实际**明文存储** | ⏳ 计划改，见 §3 |
| 15 | 所有错误返回 JSON | ✅ **已有** | 无需改 |
| 16 | 审计日志 | ✅ **已有**（`audit_logs` 表 + `logSso()`）| 无需改 |
| 17 | 限流 | ❌ 没有 | ⏳ 待议 |

---

## 2. 真实接口契约（照这个对接，别照你文档里的假设）

### 2.1 授权页（浏览器打开）

```
GET https://rainbowdoor.icu/sso/authorize
      ?client_id=rainbow-mc
      &redirect_uri=http%3A%2F%2F127.0.0.1%3A47913%2Fcallback
      &response_type=code
      &scope=profile
      &state=<32 字符随机>
      &code_challenge=<base64url(sha256(verifier))，43 字符>
      &code_challenge_method=S256
      &launcher=RAINBOW+MC
      &launcher_version=0.1.0
```

页面行为：
- 校验失败 → **400 + JSON**（不是 HTML 错误页）
- 未登录 → 前端路由跳到登录页，登录后回原 URL（query 全部保留）
- 已登录 → 显示「RAINBOW MC 啟動器 请求访问你的账号」，两个按钮
- 用户点「同意」→ 前端调 `POST /api/sso/approve` → 拿到 `redirect` 字段 →
  `window.location.href = redirect`
- 用户点「取消」→ 跳 `{redirect_uri}?error=access_denied&state=<原样>`

> ⚠️ **和你文档的差异**：不是服务端 302，而是服务端返回 `{ok:true, redirect:"..."}`
> 由**前端**执行跳转。对客户端来说结果一样（浏览器最终落到你的 callback）。
> 你不要指望 `GET /sso/authorize` 直接回 302。

配套校验接口（可选，用来提前问「这个 client_id 和 redirect_uri 合不合法」）：

```
GET https://rainbowdoor.icu/api/sso/authorize/check
      ?client_id=rainbow-mc
      &redirect_uri=http%3A%2F%2F127.0.0.1%3A47913%2Fcallback
      &code_challenge=<...>
      &code_challenge_method=S256

200 → {"ok":true,"client":{"client_id":"rainbow-mc","name":"RAINBOW MC 啟動器","scopes":"profile"}}
400 → {"ok":false,"error":"回调地址不合法（redirect_uri 未在应用里登记）"}
```

### 2.2 换令牌

```
POST https://rainbowdoor.icu/api/sso/token
Content-Type: application/json
```

```json
{
  "grant_type": "authorization_code",
  "client_id": "rainbow-mc",
  "code": "回调里拿到的 code",
  "redirect_uri": "http://127.0.0.1:47913/callback",
  "code_verifier": "客户端原始 verifier（43~128 字符）"
}
```

**成功（HTTP 200）** —— `user` 字段是 2026-10-21 按你的要求补的：

```json
{
  "ok": true,
  "access_token": "7231ad1310091d05c45cf94f9debae03ae275ff0fd0030c00d86791eed195e6f",
  "token_type": "Bearer",
  "expires_in": 2592000,
  "scope": "profile",
  "user": {
    "id": "eae3d4d7-7c22-4c98-8ae5-525ad60ff18b",
    "name": "E2E測試",
    "nickname": "E2E測試",
    "email": "mc-e2e-test@example.com",
    "avatar": null,
    "role": "user"
  }
}
```

> ⚠️ **没有 `refresh_token`**，`expires_in` 是 **2592000（30 天）**，不是 7200。

**失败（HTTP 400）**：

```json
{ "error": "invalid_grant", "error_description": "授权码无效" }
{ "error": "invalid_grant", "error_description": "授权码已被使用" }
{ "error": "invalid_grant", "error_description": "授权码已过期" }
{ "error": "invalid_grant", "error_description": "client_id 与授权码不匹配" }
```

> 注意：失败时**没有** `ok:false` 字段，只有 `error` / `error_description`。
> 你的客户端判断「成功」要用 `access_token` 是否存在，这个你已经做对了。

### 2.3 用户信息 / 校验令牌

```
GET https://rainbowdoor.icu/api/sso/userinfo
Authorization: Bearer <access_token>
```

**成功（200）**：

```json
{
  "sub": "88f74dfc-71e6-400e-8a5c-be890e707aad",
  "id": "88f74dfc-71e6-400e-8a5c-be890e707aad",
  "email": "nw202408@qq.com",
  "nickname": "鸽子",
  "avatar": "/uploads/avatars/88f74dfc-....jpg",
  "bio": "",
  "role": "admin",
  "created_at": "2026-07-26 13:44:40",
  "client_id": "rainbow-mc",
  "scope": "profile"
}
```

**失败**（已实测）：

| 情况 | 状态码 | body |
|---|---|---|
| 缺 Authorization | 401 | `{"error":"invalid_token","error_description":"缺少访问令牌"}` |
| 令牌不存在 / 已吊销 | 401 | `{"error":"invalid_token","error_description":"令牌无效或已被吊销"}` |
| 令牌过期 | 401 | `{"error":"invalid_token","error_description":"令牌已过期"}` |
| 账号被封禁 | **403** | `{"error":"account_banned","error_description":"账号已被封禁"}` |
| **被限制应用授权** | **403** | `{"error":"restricted","error_description":"该账号已被限制应用授权"}` |

> 注意最后两行的 `error` 值不一样（`account_banned` / `restricted`），
> 你的客户端如果只判断状态码，那没问题；如果判断 `error` 字符串，要都接受。

---

## 3. 三处**不做**的改动及理由

### 3.1 不加 `refresh_token`

**理由：**
- 访问令牌有效期 30 天，对一个 Minecraft 启动器来说完全够用
- 加了 refresh 就要处理：轮换、并发刷新、刷新失败回退、存储加密
- 现在的做法更简单：30 天内有效，过期后重新走一次授权（约 10 秒）

**如果你的客户端确实需要 refresh：**
告诉我你要解决的具体场景（比如「30 天内频繁启动会不断弹授权」），
我们再看是不是真的需要；大概率是别的原因造成的。

### 3.2 访问令牌不做 2 小时

同上。2 小时对启动器意味着**每天都要重新授权一次**，体验更差。

### 3.3 令牌暂时仍为明文存储（计划改，但不现在改）

**现状**：`sso_tokens.token` 存的是 64 位 hex 明文。
**风险**：数据库泄露 = 所有第三方应用令牌可用。

**为什么现在不改**：
改成哈希需要对现有令牌做迁移 —— 而哈希是不可逆的，
迁移只能**作废全部存量令牌**，会让 RAIN VPN Work 2、材料助手的用户
全部重新授权一次。这个代价要单独安排一次维护窗口。

**计划**：
1. 新签发令牌只存 `sha256(token)`，并加 `token_prefix` 列（前 8 位）用于查询
2. 存量令牌在过期后自然淘汰
3. 完成后再切到「只认哈希」

这条不影响你现在对接。

---

## 4. 我这次补上的三处（已完成并部署）

| 改动 | 位置 | 实测 |
|---|---|---|
| `/token` 响应补 `user` 对象 | `routes/sso.js` 的 `/token` | ✅ 返回含 id/name/nickname/email/avatar/role |
| `/userinfo` 补 `sso_restricted` → 403 | `requireSsoToken` | ✅ 实测 403 `{"error":"restricted"}` |
| 旧 `/api/sso/launcher-auth` → 410 | `routes/sso.js` | ✅ 实测 `HTTP 410 {"ok":false,"code":"E9100",...}` |

---

## 5. 端到端实测结果（2026-10-21）

```
① 授权页可达
   GET /sso/authorize → HTTP 200                                  ✅
   GET /api/sso/authorize/check → {"ok":true,"client":{...}}       ✅

② PKCE 正确 → 换令牌
   200 + access_token + user 对象                                  ✅
   code 重复使用 → HTTP 400                                        ✅

③ 用 token 调 /userinfo
   Bearer 头 → 200 + 完整用户信息                                   ✅
   Cookie 传 → 200 + 完整用户信息                                   ✅

④ 异常状态
   sso_restricted=1 → 403 {"error":"restricted"}                   ✅
   is_banned=1     → 403 {"error":"account_banned"}                ✅
   无令牌           → 401 {"error":"invalid_token","缺少访问令牌"}   ✅
   乱写令牌         → 401 {"error":"invalid_token","令牌无效..."}    ✅

⑤ 令牌台账
   sso_tokens 里出现 client_id=rainbow-mc 的记录，用户可在网站
   「授权管理 → 已授权的应用」里看到并撤销                          ✅
```

---

## 6. 回答你在 §12 提的三个问题

### (1) `redirect_uri` 白名单是否按 `http://127.0.0.1:47913/callback`

**是。** 已登记在 `sso_clients`：

```
client_id       rainbow-mc
name            RAINBOW MC 啟動器
redirect_uris   http://127.0.0.1:47913/callback
scopes          profile
is_active       1
```

**字面量精确匹配**，用 `127.0.0.1` 不是 `localhost`。
你如果以后想换端口，**必须同时告诉我改这一行**，否则 `/authorize` 会报
「回调地址不合法（redirect_uri 未在应用里登记）」。

### (2) `access_token` 2 小时 / `refresh_token` 30 天是否接受

**不接受这个组合。** 见 §3.1 / §3.2：我们用 **access_token 30 天、无 refresh_token**。

### (3) 取消授权时的文案

浏览器上「取消」之后的最终落地页是**你客户端的 callback 服务**渲染的
（`http://127.0.0.1:47913/callback?error=access_denied&state=...`），
所以那句话由**你的客户端**决定，服务端不管你显示什么。

服务端这边只负责把 `error=access_denied` 和原样的 `state` 带回去。

顺带说一句：你的客户端在 callback 页上写的是「你在网站上取消了授权」，这句没问题。

---

## 7. 你的文档里有两处**会踩坑**的地方，建议改

### 7.1 「授权页直接 302 跳回」

你文档 §3 第 6 步写的是「302 跳 `{redirect_uri}?code=...`」。
实际上服务端返回 `{ok:true, redirect}`，由前端 JS 跳。
**客户端不用改**（它只看浏览器最终落到 callback），但你文档描述的机制不对。

### 7.2 `userinfo` 的 `error` 值

你文档 §5 写「账号被封禁 → `{"error":"forbidden"}`」。
实际服务端返回的是 **`{"error":"account_banned", ...}`**。
如果客户端按 `error === 'forbidden'` 判断，会漏掉。
**建议只按 HTTP 状态码判断**（401 = 重新登录，403 = 联系管理员），这个你已经做对了。

---

## 8. 客户端侧需要确认的三件事（回给我即可）

1. **回调端口固定 47913** —— 确认不会改？如果会变，每次都要同步改服务端白名单
2. **不接受 `refresh_token`** —— 30 天到期后重新授权一次，可以接受吗？
3. **`sso_restricted` 的 403** —— 客户端拿到 403 时，除了「联系管理员」，
   要不要区分「封禁」和「限制授权」两种提示？现在服务端用 `error` 字段区分了

---

## 9. 附：一句话给客户端的正确做法

```
① 生成 verifier/challenge/state
② 起 127.0.0.1:47913 的临时 HTTP 服务
③ 打开浏览器到 https://rainbowdoor.icu/sso/authorize?...
④ 等 callback 拿到 code
⑤ POST /api/sso/token（PKCE）
   → 200 + access_token（有效 30 天，无 refresh_token）
⑥ 直接用 access_token 存起来
   （token 响应里已经带了 user，可以不再调 /userinfo）
⑦ 每次启动游戏前调 GET /api/sso/userinfo 校验
   401 → 提示重新授权；403 → 提示联系管理员
```

---

*服务端对应文件：`/opt/rainbow-site/server/routes/sso.js`*
*备份：`sso.js.bak.oauthalign.20261021-*`*
