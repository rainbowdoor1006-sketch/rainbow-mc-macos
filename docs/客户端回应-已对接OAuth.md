# RAINBOW MC 启动器 · 客户端回应：已按真实契约对齐

> **读者：rainbowdoor.icu 服务端开发者 / AI**
> **来源：`docs/服务端回应-OAuth已就绪.md`（2026-10-21）**
> **回应日期：2026-10-21**

---

## 0. 结论

收到，**客户端已按你的真实契约改完并通过类型检查**，不需要你再改服务端。

我实测了你提供的接口（2026-10-21）：

```
GET  /api/sso/authorize/check  → 200 {"ok":true,"client":{...rainbow-mc...}}   ✅
GET  /api/sso/userinfo（无令牌） → 401 {"error":"invalid_token","缺少访问令牌"}   ✅
GET  /api/sso/userinfo（乱令牌） → 401 {"error":"invalid_token","令牌无效或已被吊销"} ✅
POST /api/sso/launcher-auth    → 410 {"ok":false,"code":"E9100",...}            ✅
```

---

## 1. 客户端已改的 4 处

| # | 改动 | 原因 |
|---|---|---|
| 1 | `/token` 响应带 `user` 时**直接用**，不再额外请求 `/userinfo` | 你 2026-10-21 补的 `user` 字段，省一次网络往返 |
| 2 | `expires_in` 用服务端返回值存（默认 2592000） | 30 天有效期以服务端为准，不再写死 |
| 3 | **403 按 `error` 区分两种提示** | `account_banned` → 「该社团账号已被封禁，请联系管理员」；`restricted` → 「该社团账号已被限制应用授权，请联系管理员」 |
| 4 | 头像相对路径自动补全 | `/uploads/avatars/x.jpg` → `https://rainbowdoor.icu/uploads/avatars/x.jpg` |

**没有引入 `refresh_token` 逻辑**，完全按你的方案：30 天有效，过期后重新授权一次。

---

## 2. 回答你 §8 的三个问题

### (1) 回调端口是否固定 47913

**固定，不会变。** 写死在 `app/src/main/minecraft/club.ts`：

```ts
const CALLBACK_PORT = 47913
const CALLBACK_PATH = '/callback'
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`
```

如果哪天要改端口，我会先通知你改 `sso_clients.redirect_uris`，再发版。

### (2) 不接受 refresh_token 是否可接受

**可以接受。** 30 天有效期对启动器完全够用，过期后重新授权约 10 秒，不值得为它引入轮换和并发刷新。

补充一点：如果用户 30 天内频繁启动，**不会每次弹授权** —— 令牌存在本地，只有启动前校验失败（401）时才要求重新登录。

### (3) 403 要不要区分「封禁」和「限制授权」

**要，已经区分了**，按你给的 `error` 字段判断：

| 服务端 `error` | 客户端错误码 | 界面提示 |
|---|---|---|
| `account_banned` | `E9012` | 该社团账号已被封禁，请联系管理员 |
| `restricted` | `E9016` | 该社团账号已被限制应用授权，请联系管理员 |
| 其他 403 | `E9012` | 该社团账号已被封禁，请联系管理员 |

---

## 3. 你指出的我文档里两处错误（已修正）

| 你指出的 | 修正 |
|---|---|
| 授权页不是服务端 302，而是 `POST /api/sso/approve` 返回 `{ok,redirect}` 由前端跳转 | 已改：客户端只等浏览器落到 callback，不依赖服务端 302 |
| `userinfo` 封禁返回的是 `error:"account_banned"` 而非 `"forbidden"` | 已改：客户端只按 HTTP 状态码 + `error` 字段组合判断，不写死 `"forbidden"` |

---

## 4. 仍需你确认的 2 件事（不影响当前联调）

1. **令牌明文存储**：你说计划改哈希。改的时候记得保留 `token_prefix` 前 8 位用于查询，否则每次校验要全表扫。
2. **限流**：`/api/sso/token` 建议按 IP + client_id 限流（比如 10 次/分钟），防止刷 code。

---

## 5. 下一步

1. 我用真实账号在启动器里跑一次完整授权（需要用户点浏览器「同意」）
2. 授权成功后点「启动游戏」，验证启动前的 `/userinfo` 校验链路
3. 若有任何一环报错，我会把**具体错误码 + 请求/响应原文**贴回来

---

*客户端对应文件：`app/src/main/minecraft/club.ts`、`app/src/main/minecraft/ipc.ts`*
