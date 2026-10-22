# 请网站加一个 CurseForge 下载代理接口（用于整合包导入）

> **2026-10-22 更新：这件事现在变成「可选」了。**
> 免 Key 通道已可用（pi.cfwidget.com 查文件名 + mediafilez.forgecdn.net 直链），
> 实测能完整导入 CurseForge 整合包（31 个模组全部下载成功）。
> 如果你们愿意做这个代理，能少依赖第三方接口、更稳；不做也不影响功能。

> 读者：彩虹门社团网站 AI / 运维
> 日期：2026-10-22
> 目的：让启动器能导入 **CurseForge 整合包**（现在只能导入 Modrinth 的 `.mrpack`）

---

## 1. 为什么需要它

CurseForge 整合包（`manifest.json`）里**只有 ID，没有下载地址**：

```json
{
  "minecraft": { "version": "1.20.1", "modLoaders": [{ "id": "forge-47.2.0" }] },
  "files": [
    { "projectID": 275083, "fileID": 4709851, "required": true },
    ...
  ]
}
```

要下载必须先「按 ID 换直链」，而 `api.curseforge.com` **需要 API Key**：

```
GET https://api.curseforge.com/v1/mods/275083/files/4709851
    x-api-key: <key>
→ { "data": { "fileName": "jei-1.20.1-forge-15.2.0.27.jar",
              "downloadUrl": "https://edge.forgecdn.net/files/4709/851/jei-....jar" } }
```

用户自己申请 Key 门槛太高（注册要 GitHub/Google 账号，国内还常被墙），
所以想请**网站持有一个 Key**，启动器只请求你们的代理接口。

> 我实测过：`api.curseforge.com` 无 key → 403；`mod.mcimirror.top` → 503（挂了）；
> `api.curse.tools` → 403。**目前没有可用的免 key 通道**，只能自己持 key。

---

## 2. 接口约定

### 2.1 单个文件解析（必需）

```http
GET https://rainbowdoor.icu/api/cf/file?projectId=275083&fileId=4709851
```

**成功 200：**

```json
{
  "ok": true,
  "projectId": 275083,
  "fileId": 4709851,
  "fileName": "jei-1.20.1-forge-15.2.0.27.jar",
  "downloadUrl": "https://edge.forgecdn.net/files/4709/851/jei-1.20.1-forge-15.2.0.27.jar",
  "size": 1234567,
  "sha1": "可选，有就更好"
}
```

**失败（仍用 200，带 ok:false，客户端好处理）：**

```json
{ "ok": false, "error": "file_not_found", "message": "该文件不存在或已删除" }
```

错误码建议：

| error | 场景 | 客户端行为 |
|---|---|---|
| `file_not_found` | CF 返回 404 | 记为失败，继续下一个 |
| `download_disabled` | 作者关闭了 API 下载（CF 返回 `downloadUrl: null`） | 记为失败并提示 |
| `rate_limited` | 触发 CF 限流 | 建议客户端重试 |
| `upstream_error` | CF 5xx | 重试一次 |

### 2.2 批量解析（可选，推荐）

一个整合包动辄 30–100 个文件，逐个请求会很慢。建议支持：

```http
POST https://rainbowdoor.icu/api/cf/files
Content-Type: application/json

{ "files": [ { "projectId": 275083, "fileId": 4709851 }, ... ] }
```

```json
{ "ok": true, "files": [ { "projectId": 275083, "fileId": 4709851,
                          "fileName": "...", "downloadUrl": "...", "ok": true }, ... ] }
```

> 客户端当前只用 §2.1（逐个请求 + 6 并发）。批量接口做出来后我再改，不急。

---

## 3. 服务端实现要点

### 3.1 拿到 API Key

`https://console.curseforge.com/` → API Keys → 新建（免费）。
**Key 只存服务器环境变量**，不要写进代码/仓库：

```bash
# /opt/rainbow-site/server/.env
CURSEFORGE_API_KEY=$2a$10$...
```

### 3.2 调 CF API

```js
const r = await fetch(
  `https://api.curseforge.com/v1/mods/${projectId}/files/${fileId}`,
  { headers: { 'x-api-key': process.env.CURSEFORGE_API_KEY, Accept: 'application/json' } }
)
const { data } = await r.json()
// data.fileName / data.downloadUrl（可能为 null）
```

### 3.3 缓存（很重要）

CF 的 Key 有**每日配额**（免费档大约 1000 次/天级别，具体以官方为准）。
`fileId → { fileName, downloadUrl }` 是**永久不变**的，建议：

```
表 cf_file_cache(project_id, file_id, file_name, download_url, size, sha1, cached_at)
缓存 TTL：永久（文件 ID 不会变）
命中缓存直接返回，不打 CF
```

一个 30 文件的包，全班同学各导入一次 = 30 次请求，有缓存后几乎为零。

### 3.4 安全

- 只允许 `downloadUrl` 的 host 属于 `*.forgecdn.net` / `cdn.curseforge.com`，避免变成任意 URL 代理（SSRF）
- 不需要鉴权（拿到的是公开文件直链），但要限频：同一 IP 每分钟 ≤ 60 次
- 不要回传 API Key

---

## 4. 客户端侧（我已经写好，等接口上线）

已实现（0.2.21）：

```
设置 → CurseForge 整合包 → 下载代理地址（默认 https://rainbowdoor.icu/api/cf）
导入 CF 包 → 读 manifest.json 的 files[] → 逐个请求代理 → 下载到项目 mods/
进度显示：解析 CurseForge 文件 3/31… → 下载 CurseForge 模组 8/31…
失败回退：设置里可填自己的 API Key（不会外传）
```

**接口一上线，用户什么都不用配**（默认地址已经指向 `rainbowdoor.icu/api/cf`）。

---

## 5. 需要你确认

1. 这个接口能做吗？大概什么时候？
2. Key 的配额够不够（如果全班 30 人导入同一个包，缓存后几乎不耗配额）
3. 批量接口（§2.2）要不要一起做
4. 你的服务器能不能访问 `api.curseforge.com`（东京那台应该没问题）

---

## 6. 附：现在 CF 包的导入表现（已实测）

```
Ice and Fire-3.0.zip（CurseForge 包，1.20.1 + Forge 47.2.0）
→ 启动器正确识别格式 ✅
→ 解压 overrides/config（99 个配置）✅
→ 安装 Forge 47.2.0 ✅
→ 模组：0 个（31 个需要按 ID 下载）❌  ← 就是等这个接口
```

接口上线后，同样的包能完整导入。
