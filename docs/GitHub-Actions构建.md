# GitHub Actions 构建（macOS 打包）

仓库：<https://github.com/rainbowdoor1006-sketch/rainbow-mc-macos>（公开）
工作流：`.github/workflows/mac-build.yml`

---

## 一、为什么用这个

本地没有 Mac 也能出 dmg —— GitHub 提供 macOS 机器，**公开仓库的 macOS runner 免费且不限分钟数**。

| 项 | 情况 |
|---|---|
| 运行环境 | `macos-14`（Apple Silicon，arm64） |
| 单次耗时 | 约 3 分钟（实测 14:02 → 14:05） |
| 费用 | 0（公开仓库） |
| 需要 Apple 账号 | 不需要（ad-hoc 签名） |

## 二、触发方式

| 方式 | 说明 |
|---|---|
| push 到 `main` | 自动构建 |
| Pull Request | 自动构建（只验证，不发布） |
| 手动 | 仓库 → Actions → mac-build → Run workflow |
| 打 tag `v0.4.9` | 构建 + **自动创建 Release**，附 dmg / zip / SHA256SUMS.txt |

## 三、产物

```
release-mac/RAINBOWMC-macOS-<版本>-universal.dmg      ~171 MB（首次安装用）
release-mac/RAINBOWMC-macOS-<版本>-universal.zip      ~166 MB（自动更新用）
```

下载位置：仓库 → Actions → 对应那次运行 → 底部 Artifacts → `rainbowmc-macos`（保留 30 天）。

## 四、签名情况（实测日志）

```
CodeDirectory v=20400 flags=0x20002(adhoc,linker-signed)
Signature=adhoc
```

即 **ad-hoc 签名**：不需要 Apple 账号、不需要公证，Apple 芯片可运行，用户首次打开需右键 → 打开。

## 五、本地想跑同样的构建

需要一台 Mac（或 macOS 虚拟机）：

```bash
git clone https://github.com/rainbowdoor1006-sketch/rainbow-mc-macos.git
cd rainbow-mc-macos/app
npm install
npm run dist:mac
```

## 六、注意

- 工作流里设了 `CSC_IDENTITY_AUTO_DISCOVERY=false`，防止 runner 上误找证书；
- `universal` 包会同时下载 arm64 与 x64 两份 Electron（日志里能看到两次 100 MB 下载）；
- 如果以后买了 $99 开发者账号，只需去掉 `identity: null` 并加 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` 三个 secret，就能自动签名+公证，**代码不用改**。
