# macOS 上架 / 分发方案（RAINBOW MC）

- 结论先行：**Mac App Store 基本走不通，不要在这上面花时间**。可行路线是 **Developer ID 签名 + Apple 公证（notarization）+ DMG 直链分发**。
- 本文写于 2026-11-02，适用于 Electron 应用。

---

## 一、为什么 Mac App Store 不行

| 障碍 | 说明 |
|---|---|
| **App Sandbox 强制** | 上架 MAS 必须启用沙盒。沙盒下应用不能随意读写沙盒外目录、不能 `spawn` 任意可执行文件、不能下载并执行代码。 |
| **指南 2.5.2** | "Apps should be self-contained… may not download, install, or execute code which introduces or changes features or functionality." 启动器要**下载 Java 运行时、下载 Forge/NeoForge/Fabric 安装器并执行**，直接踩这条。 |
| **指南 2.5.1 / 2.4.5** | 只能使用公开 API；下载并执行第三方二进制（加载器）会被视为动态代码。 |
| **游戏本身不在 MAS** | 最终要启动的是 Mojang 的 Java 版，Apple 侧也没有对应生态，审核员会追问用途。 |
| **Sandbox 下的 Java** | 即使把 JRE 打包进 App，JVM 的 JIT 也需要 `com.apple.security.cs.allow-jit` + `allow-unsigned-executable-memory`，仍要解释；而 Modrinth/加载器下载的内容无法执行。 |
| **账号年龄** | Apple Developer Program 个人账号要求 **18 岁以上**；15 岁只能借用监护人账号或注册组织账号（需要 D-U-N-S 编号，流程 1–2 周）。 |

> 同类项目事实：Prism Launcher、MultiMC、ATLauncher、Modrinth App 全部**没有**上 MAS，都是 GitHub Releases + 公证 DMG。这不是偷懒，是唯一可行路径。

---

## 二、推荐路线：Developer ID + 公证 + DMG

### 需要的账号与费用

| 项 | 要求 |
|---|---|
| Apple Developer Program | $99/年 ≈ ¥688/年（个人需 18+，组织需 D-U-N-S） |
| 证书 | `Developer ID Application`（签 .app）+ `Developer ID Installer`（可选，签 .pkg） |
| 工具 | macOS 机器 + Xcode Command Line Tools（`codesign`、`notarytool`、`stapler`） |

### 打包流程（electron-builder）

1. 在 `electron-builder.yml` 里加：

```yaml
mac:
  target:
    - target: dmg
      arch: [arm64, x64]
  category: public.app-category.games
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true          # 需要 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
  icon: build/icon.icns
```

2. `build/entitlements.mac.plist` 至少包含：

```xml
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
<key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
```

（`disable-library-validation` 是因为要 spawn 外部的 `java`，否则 Gatekeeper 会拦。）

3. 环境变量（公证必须）：

```bash
export APPLE_ID="你的 Apple ID"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com 生成
export APPLE_TEAM_ID="XXXXXXXXXX"
```

4. 构建：

```bash
npm run build                     # 前端 + 主进程
npx electron-builder --mac dmg    # 出 dmg（会调 codesign + notarytool + stapler）
```

5. 检查：

```bash
spctl -a -vvv -t install "dist/RAINBOW MC-0.5.0-arm64.dmg"
xcrun stapler validate "dist/RAINBOW MC-0.5.0-arm64.dmg"
```

### 分发

| 方式 | 说明 |
|---|---|
| 官网直链（推荐） | `https://rainbowdoor.icu/download/RAINBOWMC-0.5.0-arm64.dmg`，和现在 Windows 一个套路 |
| GitHub Releases | 免费、可自动更新，Prism 就这么做 |
| Homebrew Cask | 提 PR 到 `homebrew-cask`，多一个曝光渠道（需要公证过的 dmg） |
| MacUpdate / 少数派 | 国内曝光 |

### 自动更新

Windows 那套（HTA + NSIS）在 mac 完全用不了。mac 建议：

- 用 `electron-updater` + `dmg`/`zip` + `latest-mac.yml`（electron-builder 自带生成），签名了就能静默替换；
- 或者简单做法：检测到新版本 → 弹窗 → 打开下载页，用户自己拖进 Applications（最省事，也不容易出错）。

---

## 三、如果坚持要上 Mac App Store（不推荐，但列清楚）

1. electron-builder 用 `mas` target（不是 `dmg`）：

```yaml
mac:
  target: [mas]
  entitlements: build/entitlements.mas.plist
  entitlementsInherit: build/entitlements.mas.inherit.plist
```

2. 必须实现 **App Sandbox**，且：

   - Java 运行时**必须打包进 App**（不能下载），体积 +200 MB 起；
   - 不能下载并运行 Forge/NeoForge 安装器 → 只能支持原版 + Fabric（Fabric 的 jar 也要打包）；
   - Modrinth 只能下载「数据」（mods 是 jar，属于可执行代码 → 又要解释）；
   - 所有路径改到 `~/Library/Containers/<bundleid>/Data`。

3. App Store Connect 建 app、上传 `.pkg`、填隐私清单（`PrivacyInfo.xcprivacy`）、过审。

4. 现实概率：**很可能被拒**（2.5.2 与 4.2 minimum functionality 双重风险），一次往返 1–3 天。

---

## 四、给 RAINBOW MC 的具体建议

1. **不上 MAS**，走「Developer ID + 公证 + DMG」。
2. 账号问题：你 15 岁，个人账号开不了。两个选择：
   - 用监护人身份注册（Apple 允许家庭共享管理，但账号主体是成年人）；
   - 先不签名，出**未签名 DMG** 内测（用户右键→打开），等你满 18 或社团有主体再补公证。
3. 先做 **arm64 单架构**（M 系列 Mac 占绝大多数），Intel 版后面再补，能省一半构建与测试成本。
4. 更新策略先用「弹窗 + 打开下载页」，别一上来做静默替换（mac 上权限/路径问题多）。

---

## 五、待办（本项目）

- [ ] 把 JRE 逻辑改成 macOS（Temurin arm64）
- [ ] 去掉全部 Windows 专属代码
- [ ] `electron-builder.yml` 加 mac 段
- [ ] 生成 `icon.icns`
- [ ] 决定签名方式（监护人账号 / 先不签名内测）
- [ ] 更新清单按平台拆（mac-arm64 / mac-x64）

---

## 六、终端用户到底怎么下载安装（macOS 侧真实流程）

> 关键认知：**走 Developer ID 路线不需要「上架」，也不需要苹果审核**。
> 你只是把一个文件放在自己网站上，macOS 负责验证「这个 App 是不是你签的、有没有被改过、苹果有没有公证过」。

### 6.1 用户操作步骤（公证过的 DMG）

```
1. Safari 打开 https://rainbowdoor.icu/download/   ← 就是普通网页，没有 App Store
2. 点「下载 macOS 版（Apple 芯片）」→ 文件落到「下载」文件夹
3. 双击 RAINBOWMC-0.5.0-arm64.dmg
4. 弹出磁盘映像窗口：把 RAINBOW MC 图标拖到「应用程序」文件夹
5. 在启动台/应用程序里双击打开
6. 第一次会弹「RAINBOW MC 是从互联网下载的 App，确定要打开吗？」→ 点「打开」
7. 之后每次打开都不再提示
```

第 6 步的提示是**一次性的**，这是 macOS 的标准行为，公证过的 App 只需确认一次。

### 6.2 公证 vs 未公证，用户看到什么

| 状态 | 用户看到的 | 能否用 |
|---|---|---|
| 已签名 + 已公证 + 已 staple | 「是从互联网下载的 App，确定要打开吗？」→ 打开 | ✅ 顺畅 |
| 已签名 + 未公证 | 「无法打开，因为 Apple 无法检查其是否包含恶意软件」 | ⚠️ 需要右键→打开，或在「系统设置→隐私与安全性」点「仍要打开」 |
| 未签名 / 签名损坏 | **Apple 芯片上直接拒绝运行**（`killed: 9`），Intel 上可右键打开 | ❌ 基本不可用 |
| 被改过（哈希不符） | 「App 已损坏，建议移到废纸篓」 | ❌ 必须重下 |

所以对 Apple 芯片（M 系列）机器，**签名是硬性的**，公证是体验上的。

### 6.3 你们网站要做的事

| 项 | 要求 |
|---|---|
| 托管方式 | 普通静态文件（Nginx/OSS/CDN 都行），和现在放 Windows exe 一样 |
| Content-Type | `application/x-apple-diskimage`（不强制，但更规范） |
| 支持 Range | 建议支持（断点续传、下载器兼容） |
| 文件名 | 带架构：`RAINBOWMC-0.5.0-arm64.dmg` / `-x64.dmg`，避免用户下错 |
| 校验 | 页面上给出 SHA-256，让用户 `shasum -a 256` 自查 |
| 版本清单 | 现有 `/api/launcher/version` 要按平台返回不同条目（mac-arm64 / mac-x64） |

### 6.4 为什么不打包成 .pkg 或 .zip

- `.zip`：解压后可能丢可执行权限（除非用 `ditto` 压缩），用户容易踩坑；
- `.pkg`：需要 `Developer ID Installer` 证书，安装过程反而更吓人；
- `.dmg`：最符合 Mac 习惯（拖进 Applications），也是 Prism/MultiMC 等同类项目的选择。

### 6.5 双架构怎么处理

| 方案 | 优点 | 缺点 |
|---|---|---|
| 出两个 DMG（arm64 / x64） | 体积小（各 ~100 MB） | 用户要选，容易下错 |
| 出一个 universal DMG（`--universal`） | 用户无需选择 | 体积翻倍（~200 MB），构建慢 |

**建议**：先出 `universal`（用户无脑下载），等体积成问题再拆。

### 6.6 自动更新（mac 侧）

Windows 那套（HTA + NSIS + `KEEP DATA`）在 mac 完全不适用。两个方案：

1. **简单可靠**：启动器检测到新版 → 弹窗「有新版 0.5.1」→ 点按钮打开下载页 → 用户自己拖新的进 Applications（数据在 `~/Library/Application Support`，不受影响）；
2. **静默替换**：`electron-updater` + `latest-mac.yml` + 已签名 DMG/ZIP，能下载后自动替换并重启。要求签名+公证都齐全，否则替换后打不开。

## 七、给用户的分发页文案（可直接放到社团网站）

```
RAINBOW MC for macOS

版本 0.5.0 · 需要 macOS 12 或更新

[下载（Apple 芯片 M1/M2/M3/M4）]  [下载（Intel）]
SHA-256: xxxxx

安装方法：下载后双击打开，把 RAINBOW MC 拖进「应用程序」即可。
第一次打开若提示「无法验证开发者」，请右键点图标 → 选「打开」。
```

---

## 八、关于「用 App Store 的更新机制」这件事

### 8.1 直说结论

**RAINBOW MC 这类启动器，目前上不了 Mac App Store。** 不是签名/公证的问题，是产品形态和审核条款冲突。

具体撞的条款：

| 条款 | 原文要点 | 我们撞在哪 |
|---|---|---|
| 2.5.2 | Apps should be self-contained; may not download, install, or execute code which introduces or changes features or functionality | 启动器要下载 **Java 运行时**、下载 **Forge/NeoForge/Fabric 安装器** 并执行、下载 **mods（jar，属于可执行代码）** 并在游戏里加载 |
| 4.2 Minimum Functionality | App 本身要有独立功能，不能只是外壳/下载器 | 启动器本质是「下载 + 启动外部游戏」，审核员极容易按这条拒 |
| App Sandbox | 上架必须启用，禁止访问沙盒外文件、限制子进程 | 游戏目录、存档、Java 进程都要在容器内重做，用户既有的 `.minecraft` 也读不到 |

事实佐证：**Prism Launcher、MultiMC、ATLauncher、Modrinth App、HMCL 全部没有上 MAS**，连 Mojang 官方的 Minecraft Java 版都不在 MAS。这个品类在 App Store 里是空白的——不是大家没想到，是上不去。

### 8.2 还有一个你可能没注意的点

即使侥幸过审，**MAS 的「更新」也不是即时的**：

- 每次发版都要上传 App Store Connect → 提交审核 → **等 1–3 天**；
- 审核被拒就要改代码重来；
- 用户那边是「系统自动更新」，快的话也是发布后几小时到一天。

所以它并不是「我改完代码，用户马上就是新版」。

### 8.3 但你真正想要的「App Store 式更新」，MAS 之外也能做到

你要的其实是：**用户不用管，启动器自己更新**。这个在 MAS 外完全能实现，而且立刻生效。

| 方案 | 用户感知 | 你要做的事 | 即时性 |
|---|---|---|---|
| **A. electron-updater + 自托管 feed**（推荐） | 启动器内提示「有新版本 → 正在下载 → 重启完成」，**从不打开网页** | 发版时把 `latest-mac.yml` + dmg/zip 传到服务器 | 立刻 |
| **B. Sparkle 2 + appcast.xml** | 同样在 App 内完成，mac 上最正统 | 生成 appcast、签名更新包 | 立刻 |
| C. 手动下载页 | 用户自己点链接、拖 App | 只需放文件 | 立刻（但体验差） |

方案 A 的实现要点：

1. `electron-builder` 出 `dmg` + `zip`（zip 给自动更新用，dmg 给首次安装）；
2. 配置 `publish: { provider: 'generic', url: 'https://rainbowdoor.icu/download/mac/' }`；
3. 主进程接 `autoUpdater.checkForUpdates()`，有新版就 `downloadUpdate()` → 完成后提示「重启以完成更新」；
4. 全程用户看不到浏览器，和 App Store 体验一致；
5. 前提：**签名 + 公证**（否则替换后的 App 打不开）。

> 换句话说：你想要的「自动更新体验」不需要 App Store，只需要签名 + 一个 feed 地址。

### 8.4 如果一定要试 MAS，产品要砍成什么样

| 项目 | MAS 版能做到 | 代价 |
|---|---|---|
| 原版启动 | ✅ 可以（JRE 打包进 App） | 安装包 +180~220 MB |
| 版本下载 | ⚠️ 只下载 assets/资源（数据），jar 必须打包 | App 体积再涨，且只能内置有限版本 |
| Forge / NeoForge | ❌ 安装器要执行代码 | 直接砍掉 |
| Fabric / Quilt | ⚠️ 勉强（loader jar 打包内置） | 复杂度高 |
| Modrinth 模组 | ❌ jar 是可执行代码 | 直接砍掉（这会砍掉启动器一半价值） |
| 光影包 | ✅ 是资源不是代码 | 可以保留 |
| 更新 | 走 App Store 审核 | 每次 1–3 天 |

**结论：MAS 版会变成一个「只能玩原版、不能装 mod」的残缺产品。** 这跟你做启动器的目标冲突。

### 8.5 建议

1. **不上 MAS**，走「Developer ID + 公证 + DMG + electron-updater」——用户体验和 App Store 几乎一样，还不用审核；
2. 更新 feed 放在你自己服务器或 GitHub Releases，用户全程无感；
3. 内存/权限那些 mac 限制，通过签名 entitlements 解决（`allow-jit` 等）。

## 九、待决策

| 选项 | 含义 |
|---|---|
| **A（推荐）** | DMG + 公证 + electron-updater 自动更新（体验≈App Store，无需审核） |
| B | 先不签名，出未签名 DMG 内测，更新用手动下载 |
| C | 硬试 MAS：砍掉 Forge/Mod，JRE 打包，接受高拒审风险与每次 1–3 天审核 |

---

## 十、零成本方案（不实名、未成年可用、功能全保留）

### 10.1 先明确三条硬事实

1. **公证（notarization）没有免费途径**，必须 $99/年 的 Apple Developer Program，且个人账号要求 18 岁以上。这条绕不过。
2. **Apple 免费 Apple ID 的「Personal Team」只适用于 iOS/iPadOS 开发**（7 天签名过期），**不能**给 macOS 应用做 Developer ID 签名，也不能公证。
3. **macOS 上「未公证」不等于「不能运行」**，只是第一次要用户手动放行一次。

### 10.2 可行方案：ad-hoc 签名（0 元，不需任何 Apple 账号）

Apple 芯片要求可执行文件**至少有签名**（哪怕是 ad-hoc），否则直接 `killed: 9`。ad-hoc 签名（`codesign -s -`）**不需要任何证书、不需要实名、免费**。

| 项 | 情况 |
|---|---|
| 需要 Apple 账号 | ❌ 不需要 |
| 需要实名/成年 | ❌ 不需要 |
| 花钱 | ❌ 0 元 |
| 功能是否完整 | ✅ **完整**（无沙盒，Java/Forge/Mod 全部照常） |
| 用户体验 | ⚠️ 第一次打开要「右键 → 打开」，之后正常 |
| 自动更新 | ✅ 可用（应用自己下载的文件不带 quarantine 标记，替换后直接能开） |

**构建配置（electron-builder）：**

```yaml
mac:
  identity: null            # 不找开发者证书，走 ad-hoc 签名
  hardenedRuntime: false    # 没公证就不需要 hardened runtime，JIT 也就不需要 entitlement
  target: [dmg, zip]
```

构建完自检：

```bash
codesign -dv --verbose=2 "dist/mac-arm64/RAINBOW MC.app"   # 应显示 Signature=adhoc
```

### 10.3 用户第一次打开怎么放行（三种，任选）

| 方式 | 操作 | 备注 |
|---|---|---|
| 右键打开 | 右键 App 图标 → 打开 → 再点「打开」 | 最直观 |
| 系统设置 | 双击被拦 → 系统设置 → 隐私与安全性 → 点「仍要打开」 | macOS 15 起要在设置里点 |
| 终端一条命令 | `xattr -dr com.apple.quarantine "/Applications/RAINBOW MC.app"` | 最快，可做成 `.command` 脚本塞进 DMG |

**建议做法**：DMG 里除了 App，再放一个 `首次打开请双击我.command`，内容是上面这条命令 + `open "/Applications/RAINBOW MC.app"`。用户双击一次就再也不会被拦。

### 10.4 关于自动更新（这条决定了体验）

- 用户从**浏览器**下载的 DMG 带 `com.apple.quarantine` → 首次要放行；
- 但启动器**自己**用 `electron-updater` 下载的更新包**不带** quarantine 标记（quarantine 只由浏览器等主动打标记的 App 添加）；
- 所以：**首次安装手动放行一次，之后所有版本更新都是静默完成，用户无感。**

这已经非常接近 App Store 的体验了，代价只有第一次那一下。

### 10.5 其他零成本选项（可选，不推荐为主路径）

| 方案 | 是否可行 | 说明 |
|---|---|---|
| Homebrew Cask | ✅ | 用户 `brew install --cask --no-quarantine rainbow-mc`，但前提是用户装了 Homebrew，且国内网络对 brew 不友好 |
| 自签名证书（Keychain 里自建） | ⚠️ 等效 ad-hoc | 不会让 Gatekeeper 放行，只增加复杂度，没有收益 |
| 关闭 Gatekeeper（`spctl --master-disable`） | ❌ 不做 | 需要管理员权限，且降低整机安全性，绝不能要求用户做 |
| 免费 Apple ID / Personal Team | ❌ | 只支持 iOS 开发，不能签 macOS 分发版 |
| 让别人（社团/学校）的付费账号签 | ⚠️ | 技术上可行，但证书归属不是你的，出问题无法自证 |

### 10.6 结论

**走 ad-hoc 签名 + DMG + electron-updater。** 0 元、不需要实名、不需要成年、功能一个不少；唯一代价是首次安装要用户点一次「打开」。

如果将来想要「双击即开、没有任何提示」的体验，那时再花 $99 补 Developer ID + 公证，**代码不用改**，只换签名配置。
