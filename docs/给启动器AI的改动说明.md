# 给 RAINBOW MC 启动器项目的 AI：网站侧改了什么

> **谁写的**：彩虹门社团网站（rainbowdoor.icu）侧的 AI
> **写给谁**：负责 RAINBOW MC 启动器客户端（Electron + React）的 AI
> **日期**：2026-10-22
> **背景**：一批本该在启动器对话里做的活，误发到了网站对话里。既然已经做了，
> 这里把**我动过的每一个文件、原因、以及你必须知道的事情**列清楚，方便你接手。
>
> ⚠ 我改的是**你负责的仓库**，如果和你的改动冲突，以这份清单为准逐条核对。

---

## 0. 一句话总结

我主要做了三类事：

1. **改写了社团账号登录**：从「启动器里填账号密码 POST」改成 **OAuth2 + PKCE 浏览器跳转**
2. **安装器免责条款改成 3 语言**（简体 / 繁體 / English），修掉了乱码
3. **打包与发布**：版本号推进到 0.2.20，打了安装包并发到服务器

顺带：备份源码到 F 盘、删掉 `D:\APP` 里的旧安装（存档已保留）。

---

## 1. 我改过的文件（逐个）

### 1.1 `app/src/main/minecraft/club.ts` —— 重写 `clubAuthorize`

**改动前（原来的实现）**：在启动器界面里填「社团账号 + 密码」，POST 到
`{baseUrl}{authPath}`，服务端返回 `{ok, token, user}`。

**改动后**：**OAuth2 授权码 + PKCE，走系统浏览器**。

```ts
// 签名变了！原来有 username / password 三个参数，现在只有一个
- export async function clubAuthorize(settings, username, password): Promise<ClubAuthResult>
+ export async function clubAuthorize(settings: AppSettings): Promise<ClubAuthResult>
```

流程：

```
① 生成 code_verifier / code_challenge(S256) / state
② 在 127.0.0.1:47913 起临时 HTTP 服务监听 /callback
③ shell.openExternal('https://rainbowdoor.icu/sso/authorize?...')
④ 用户在网站登录并点「同意授权」
⑤ 网站回跳 http://127.0.0.1:47913/callback?code=...&state=...
⑥ POST /api/sso/token（code + code_verifier）→ access_token
⑦ GET /api/sso/userinfo（Bearer）→ 用户信息
⑧ 关掉临时服务，返回 { ok, token, user }
```

**关键常量**（改端口必须同时改服务端 `sso_clients.redirect_uris`）：

```ts
CLIENT_ID      'rainbow-mc'
CALLBACK_PORT  47913
CALLBACK_PATH  '/callback'
REDIRECT_URI   'http://127.0.0.1:47913/callback'
授权超时        5 分钟
```

**你加的 `clubVerify()` 我原样保留了**，没动。

新增的错误码（客户端侧）：

| 码 | 含义 |
|---|---|
| `E9005` | 打不开浏览器 |
| `E9006` | 接口返回非 JSON / 换 token 失败 / 读用户信息失败 |
| `E9007` | 缺少用户 id |
| `E9008` | 连不上社团站点 |
| `E9110` | 等待授权超时（5 分钟）|
| `E9111` | 取消授权 / state 不匹配 / 端口被占用 / 没拿到 code |

### 1.2 `app/src/main/minecraft/ipc.ts` —— 两处调用点

```ts
// account:offlineLogin
- const auth = await clubAuthorize(s.settings, payload.clubUser || '', payload.clubPass || '')
+ const auth = await clubAuthorize(s.settings)

// account:clubCheck
- ipcMain.handle('account:clubCheck', async (_e, payload: { clubUser: string; clubPass: string }) => {
-   const auth = await clubAuthorize(state().settings, payload.clubUser || '', payload.clubPass || '')
+ ipcMain.handle('account:clubCheck', async () => {
+   const auth = await clubAuthorize(state().settings)
```

IPC 通道名**没改**（渲染进程继续调得动），只是参数不再使用。
`preload` 里 `offlineLogin(name, clubUser, clubPass)` 的签名也没改，
渲染层继续传空字符串 `offlineLogin(name, '', '')`。

### 1.3 `app/src/renderer/src/components/Dialogs.tsx` —— 去掉账号密码输入框

`LoginOffline` 组件：

- 删掉 `clubUser` / `clubPass` 两个 `useState` 和两个 `<input>`
- 提示文案从 `accounts.clubHint` 改成 `accounts.clubSsoHint`
- 提交按钮的禁用条件从 `busy || !name.trim() || !clubUser.trim()` 改成 `busy || !name.trim()`
- busy 时按钮文字显示 `accounts.waitingBrowser`（等待浏览器授权…）

现在的界面：

```
离线登录

点击下面的按钮后会打开浏览器，到社团网站用你的账号完成授权，
授权完成后自动回到启动器。

[游戏昵称]
________________
昵称只能是 3-16 位字母、数字或下划线

              [取消]  [授权并登录]
                       ↑ 点击后变「等待浏览器授权…」
```

### 1.4 `app/src/renderer/src/i18n/locales/*.ts` —— 新增一个 key

```
accounts.clubSsoHint
```

加在 9 个语言文件里（`zh-CN` `zh-TW` `en-US` `ja-JP` `ko-KR` `ru-RU` `fr-FR` `es-ES` `de-DE`）。
`en-GB` 继承 `en-US`、`zh-HK` 继承 `zh-TW`，不用单独加。

| 语言 | 文案 |
|---|---|
| zh-CN | 点击下面的按钮后会打开浏览器，到社团网站用你的账号完成授权，授权完成后自动回到启动器。 |
| zh-TW | 點擊下面的按鈕後會開啟瀏覽器，到社團網站用你的帳號完成授權，授權完成後自動回到啟動器。 |
| en-US | Clicking the button below opens your browser so you can authorise with your club account. You will return to the launcher automatically. |

### 1.5 `app/src/main/store.ts` —— 默认值 + 迁移

```ts
clubApi: {
-  baseUrl: 'https://club.example.com',
-  authPath: '/api/launcher/authorize',
-  mockMode: true
+  baseUrl: 'https://rainbowdoor.icu',
+  authPath: '/api/sso/launcher-auth',   // 现在已不用，OAuth 走 /sso/authorize
+  mockMode: false
}
```

**还加了迁移**（`state()` 里读完配置后）：

```ts
const ca = cache.settings.clubApi
if (!ca.baseUrl || ca.baseUrl.includes('club.example.com')) {
  cache.settings.clubApi = { ...DEFAULT_SETTINGS.clubApi }
  persist()
}
```

**为什么必须有**：老用户 `config.json` 里存着 `club.example.com`，
不迁移就一直走 `mockMode: true`，登录**根本不校验密码**。

> ⚠ 如果你后来把 `clubApi` 整块删了，这段迁移也就没用了 —— 但你删的时候
> 记得确认 `club.ts` 不再读 `clubApi.mockMode`，否则会读 `undefined`。

### 1.6 `app/package.json`

| 改动 | 说明 |
|---|---|
| `version` 0.2.0 → 0.2.1 → **0.2.20** | 每次发版前升，**你出包后一定要记得提** |
| 删除 `build.nsis.license` | 见 §2，不然会多一个单语言许可页 |

### 1.7 `app/build/installer.nsh` —— 新增 3 语言许可页

文件末尾追加：

```nsis
!macro customPageAfterChangeDir
  ; 2052 = 简体中文   1028 = 繁體中文   1033 = English (US)
  LicenseLangString RAINBOW_LICENSE_FILE 2052 "${BUILD_RESOURCES_DIR}\license_zh_CN.txt"
  LicenseLangString RAINBOW_LICENSE_FILE 1028 "${BUILD_RESOURCES_DIR}\license_zh_TW.txt"
  LicenseLangString RAINBOW_LICENSE_FILE 1033 "${BUILD_RESOURCES_DIR}\license_en_US.txt"

  !insertmacro MUI_PAGE_LICENSE "$(RAINBOW_LICENSE_FILE)"
!macroend
```

原有的 `preInit` / `customInit` / `customRemoveFiles` / `customInstall` /
`customUnInstall` **一行没动**。

### 1.8 `app/build/` 新增 3 个条款文件

```
license_zh_CN.txt   2431 字节
license_zh_TW.txt   2443 字节
license_en_US.txt   2762 字节
```

内容 = 原来的五节 + 新增两节：

```
六、数据安全      —— data\ 文件夹的作用，安装/覆盖/卸载都不删
七、使用前请确认  —— 点「我接受」即表示同意
```

### 1.9 `app/build/LICENSE.txt` —— 已移走

移到了 `docs/旧版权声明留档_单语言版.txt`。备份 `LICENSE.txt.bak.*` 也一并移走。

**原因见 §2，这是本次最关键的一个坑。**

### 1.10 9 个 `.ts` / `.tsx` 文件去掉了 BOM

```
src/main/minecraft/library.ts
src/renderer/src/components/DownloadOrb.tsx
src/renderer/src/i18n/locales/{de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-TW}.ts
```

**原因**：PowerShell 的 `[Text.Encoding]::UTF8` 写文件会带 BOM。
BOM 在 `.ts` 里 esbuild 能处理，不影响构建，但既然发现了就统一清掉。

> ⚠ **以后用 PowerShell 改文本文件，一定要用无 BOM 的写法**，否则
> `package.json` 会被写成 `\uFEFF{...}`，electron-builder 直接报
> `expect { or n, but found �`。我就踩了这一次。

---

## 2. ⚠ 最重要的一条：`electron-builder` 会自动捡起 `build\LICENSE.txt`

这是用户报「三种语言都选了还是简体」的真正原因。

```
即使 package.json 里没有 nsis.license，
electron-builder 也会自动发现 build\LICENSE.txt，
生成一个「单语言」的许可页，而且排在自定义页前面。
```

现象：

```
界面是 English  ✓
条款正文是旧简体 ✗（正文里能看到 "incl." 字样）
```

**已修复**：`LICENSE.txt` 移出 `build\` → 只剩我的三语言页。

**以后判断新旧包的方法**（看条款正文第一节）：

| 看到的词 | 是哪一版 |
|---|---|
| `incl.` | 旧包（单语言 LICENSE.txt）|
| `含` | 新包（简体）|
| `including` | 新包（English）|

---

## 3. 服务端这边已经做好的（你不用管）

### 3.1 更新接口

```
GET https://rainbowdoor.icu/api/launcher/version
  Header  X-Launcher-Channel: stable | beta
  Header  If-None-Match: "<etag>"       → 304
```

已发布的版本（`launcher_releases` 表）：

```
id  9  0.2.20  code 40  启用  RAINBOWMC-0.2.20-setup-r1.exe  81,856,030  当前最新
id  8  0.2.19  code 39  启用
id  7  0.2.9   code 29  启用
id  6  0.2.7   code 27  启用
id  5  0.2.6   code 26  启用
id  4  0.2.5   code 25  启用
id  3  0.2.1   code 21  启用
id  2  0.2.0   code 20  停用
id  1  0.1.0   code 10  启用
```

**发布工具**：`/opt/rainbow-site/server/tools/launcher-release.js`

```bash
node tools/launcher-release.js --add --channel stable \
  --version 0.2.21 --code 41 \
  --file /root/build/RAINBOWMC-0.2.21-setup-r1.exe --notes "..."
```

它会**自动做两件事**：
1. 写 `launcher_releases`（决定自动更新）
2. 调 `syncDownloadEntry()` 更新网站「软件支持」卡片

### 3.2 网站「软件支持」已上架

```
https://rainbowdoor.icu/download  →  桌面应用  →  RAINBOW MC Minecraft 启动器
版本 v0.2.20 / 78.1 MB
图标 /uploads/software/rainbow-mc-original.png  （就是 app/build/icon.ico）
```

### 3.3 SSO 客户端已登记

```
client_id      rainbow-mc
name           RAINBOW MC 啟動器
redirect_uris  http://127.0.0.1:47913/callback
scopes         profile
```

**改端口必须告诉我**，否则 `/authorize` 会报「回调地址不合法」。

---

## 4. 我踩过的、你以后会遇到的坑

### 4.1 发布前必须核对 exe 的版本资源

```powershell
(Get-Item 包路径).VersionInfo.ProductVersion   # 必须等于要发布的版本号
```

**为什么**：`electron-builder` 把 `package.json` 的 `version` 写进 exe 资源。
如果只改了 `package.json` 没重打，或者反过来，就会出现：

```
接口说 0.2.1(21)，装完客户端自报 0.2.0(20)
→ 永远「落后」→ 反复弹更新 → 每次重下 78 MB
```

我遇到过两次（0.2.0 → 0.2.1 那一轮），后来都是**先 `npm version` 再打包**。

### 4.2 Cloudflare 会缓存 `.exe` 4 小时

原地替换文件后：

```
cf-cache-status: EXPIRED
cache-control: max-age=14400, must-revalidate     ← CF 覆盖了 nginx 的 no-cache
```

**后果**：最长 4 小时内客户端可能下到旧文件，而接口已给新 sha256 → 校验失败。

**解法**：文件名加构建号 `-r1` / `-r2` / `-r3`，每次换名。

### 4.3 NSIS 许可页的语言 ID 要用数字

```nsis
LicenseLangString NAME ${LANG_SIMPCHINESE} "..."    ; ❌ 这个常量在
                                                    ; electron-builder 生成的
                                                    ; 脚本里未定义
LicenseLangString NAME 2052 "..."                   ; ✅ 用数字最稳
```

`warning 7025` 会被 electron-builder **当成错误**，直接构建失败。

### 4.4 条款 txt 必须 UTF-8 **带 BOM**

NSIS 的 Unicode 安装器靠 BOM 判断编码。没有 BOM 会按系统代码页（GBK）解释
→ 中文全变问号/方块。这是「中文乱码」最常见的根因。

### 4.5 `customPageAfterChangeDir` 的位置

许可页会出现在**选完安装目录之后**，不是标准 NSIS 的「欢迎页之后」。
因为 electron-builder 的模板顺序是 welcome → directory → 我的页 → install。

功能没问题，只是顺序和传统安装程序不同。

---

## 5. 我做的与打包/环境相关的操作

| 操作 | 详情 |
|---|---|
| 源码备份 | `F:\RAINBOW-MC-源码备份_20261022_155734\`（114 个文件，排除 node_modules / out / release） |
| 产物清单 | 备份里附 `_发布产物清单.txt`，36 个安装包的 sha256 |
| 删除旧安装 | `D:\APP\RAINBOWMC`、`D:\APP\RAINBOW MC` 已删 |
| **存档保留** | `D:\APP\RAINBOWMC\data`（**3.12 GB**）已改名到 `D:\APP\RAINBOWMC_data_备份_20261022_155753` |
| **配置保留** | `%APPDATA%\rainbow-mc` 已改名到 `rainbow-mc_备份_20261022_155805` |
| 注册表 | `RAINBOW MC 0.2.20` 卸载项已清 |

> 要恢复存档：把 `RAINBOWMC_data_备份_20261022_155753` 改回 `data`，
> 放进新的安装目录，启动器就能认出来。

---

## 6. 你接手后建议先做的事

1. **拉一遍 `club.ts`**，确认 OAuth 版和你的 `clubVerify()` 没冲突
2. **确认 `package.json` 的 version 是 0.2.20**（我最后一次改的）
3. **下次出包记得先 `npm version`**，再 `npm run build && npx electron-builder --win nsis --x64`
4. **别在 `build\` 里放 `LICENSE.txt`**（会被自动当许可页）
5. **改回调端口的话告诉我**，我同步改服务端 `sso_clients.redirect_uris`

---

## 7. 当前服务端契约速查

```
① 授权
GET  https://rainbowdoor.icu/sso/authorize
       ?client_id=rainbow-mc&redirect_uri=http://127.0.0.1:47913/callback
       &response_type=code&scope=profile&state=<随机>
       &code_challenge=<base64url(sha256(verifier))>&code_challenge_method=S256

② 换令牌
POST https://rainbowdoor.icu/api/sso/token
     { grant_type:"authorization_code", client_id:"rainbow-mc",
       code, redirect_uri, code_verifier }
  →  { ok:true, access_token, token_type:"Bearer", expires_in:2592000,
       scope:"profile", user:{ id, name, nickname, email, avatar, role } }

③ 校验 / 取用户
GET  https://rainbowdoor.icu/api/sso/userinfo
     Authorization: Bearer <access_token>
  →  200 用户信息
  →  401 {"error":"invalid_token"}        令牌缺失/无效/过期
  →  403 {"error":"account_banned"}       封禁
  →  403 {"error":"restricted"}           被限制应用授权

④ 更新检查
GET  https://rainbowdoor.icu/api/launcher/version
     X-Launcher-Channel: stable
  →  { ok:true, channel, latest:{ version, versionCode, downloadUrl,
        sha256, size, publishedAt, notes, mandatory, minSupported },
       installer:{ type:"nsis", silentArgs:"/S", keepDataArgs:"/KEEPDATA" } }
```

**令牌有效期 30 天，没有 refresh_token**（服务端明确不做）。

---

## 8. 相关的服务端文件（备查）

```
/opt/rainbow-site/server/routes/sso.js             SSO 全部接口
/opt/rainbow-site/server/routes/launcher.js        更新接口
/opt/rainbow-site/server/tools/launcher-release.js 发布 CLI（含 syncDownloadEntry）
/opt/rainbow-site/launcher/                        安装包静态目录
/etc/nginx/conf.d/rainbowdoor.conf                 location /launcher/（两个 server 块）
```

数据库表：

```
sso_clients         rainbow-mc 已登记
sso_tokens          令牌台账（30 天）
launcher_releases   版本发布记录
downloads           id='rainbow-mc' 对应网站「软件支持」那条
```

---

*本文件由网站侧 AI 生成，供启动器侧 AI 接手核对。*
*如有冲突或疑问，以服务端实际行为为准，可以让用户转达。*
