# macOS 移植进度与构建说明

> 本文件只属于 `RAINBOW-MC-macOS`。Windows 项目（`RAINBOW-MC-启动器`）保持只读、未做任何改动。

---

## 一、已完成的代码改造（2026-11-02）

| 文件 | 改动 | 说明 |
|---|---|---|
| `src/main/platform.ts` | **新增** | 平台判断（`isWin/isMac/macArch`）、`JAVA_BIN`、`JAVA_REL`、`platformTag()`、`updatePackageName()` |
| `src/main/minecraft/java.ts` | 重写 JRE 下载 | mac 走 Adoptium `os=mac&architecture=arm64/x64`，包是 `.tar.gz`（用系统 `tar` 解），java 路径 `Contents/Home/bin/java`，解压后 `chmod 755` |
| `src/main/paths.ts` | mac 数据目录 | `installRoot()` 在 mac 返回 `null` → 数据落到 `~/Library/Application Support/RAINBOWMC`，不会写进 .app |
| `src/main/update.ts` | mac 更新分支 | mac 不跑 HTA/NSIS/注册表，改为打开下载页（`RM_UPDATE_PAGE` 可覆盖） |
| `src/main/minecraft/ipc.ts` | 应用更新不退出 + java 名 | mac 更新后不 `app.quit()`；找 java 时接受 `java` 与 `javaw.exe` |
| `src/main/minecraft/memory.ts` | mac 不支持内存优化 | 返回完整 `MemResult` 结构并提示「macOS 由系统管理内存」 |
| `src/main/minecraft/sysinfo.ts` | mac 硬件信息 | `sysctl` 读 CPU/内存，`system_profiler` 读显卡 |
| `src/main/index.ts` | 关窗即退出 | 统一 `app.quit()`（mac 默认关窗不退出，启动器不行） |
| `app/package.json` | 构建配置 | 新增 `mac` / `dmg` 段（ad-hoc 签名、universal、dmg+zip）、`dist:mac*` 脚本、产物目录 `release-mac` |

## 二、构建命令（必须在 macOS 上执行）

```bash
cd app
npm install                # 若 node_modules 从 Windows 复制过来不适用时可重装
npm run dist:mac           # universal（Intel + Apple 芯片），输出 release-mac/
npm run dist:mac:arm64     # 只出 Apple 芯片版（体积小一半）
npm run dist:mac:x64       # 只出 Intel 版
```

产物命名（**刻意与 Windows 区分**）：

```
release-mac/RAINBOWMC-macOS-0.5.0-universal.dmg
release-mac/RAINBOWMC-macOS-0.5.0-universal.zip
```

Windows 版仍然是 `release/RAINBOWMC-0.5.0-setup.exe`，两者目录、文件名都不重叠。

## 三、签名说明（ad-hoc）

`package.json` 里 `mac.identity = null` → electron-builder 用 ad-hoc 签名（`codesign -s -`），**不需要 Apple 账号、不需要实名、0 元**。

自检（在 mac 上）：

```bash
codesign -dv --verbose=2 "release-mac/mac-universal/RAINBOW MC.app"   # 应显示 Signature=adhoc
```

用户首次打开需要放行一次（右键 → 打开），或在 DMG 里附一个 `首次打开请双击我.command`：

```bash
#!/bin/bash
xattr -dr com.apple.quarantine "/Applications/RAINBOW MC.app"
open "/Applications/RAINBOW MC.app"
```

## 四、还没做的（下一步）

1. 在 macOS 上实机跑一遍 `npm run dist:mac`，确认 dmg 能出、能装、能起。
2. 第一次启动会下载 mac 版 JRE（Temurin），要实测下载与 `chmod` 是否正常。
3. 启动游戏实测：`java` 进程、内存参数、游戏窗口。
4. `netopt.ts`（网络优化）与 `multiplayer.ts`（Terracotta 联机）里仍有 Windows 命令，mac 上需要另写或直接禁用入口。
5. `feedback.ts`（反馈上传日志）里的 `tasklist` 需要换 `ps`。
6. 更新流程：现在 mac 是「打开下载页」，之后可以换 `electron-updater` 做应用内静默更新。
7. 首次打开放行的 `.command` 脚本还没做进 DMG。

## 五、风险与注意

| 风险 | 说明 |
|---|---|
| Electron 的 mac 包不能在 Windows 上打 | `electron-builder --mac` 必须跑在 macOS（或 macOS CI），本地无法验证 |
| `node_modules` 从 Windows 复制 | 里面的原生模块（如 `adm-zip` 纯 JS 无碍，但其他若有 native 依赖）在 mac 上要重新 `npm install` |
| 未签名/未公证 | 首次打开必须手动放行；企业用户可能被 MDM 拦住 |
| 数据目录不同 | Windows 是安装目录下 `data/`，mac 是 `~/Library/Application Support/RAINBOWMC`，两平台存档不能直接互拷（除 `data/games` 内容本身） |
