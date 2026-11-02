/** 平台判断与路径约定（macOS 移植用）。Windows 逻辑保持不变。 */
import { join } from 'path'
import { app } from 'electron'

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

/** mac 上的 CPU 架构（arm64 = Apple 芯片，x64 = Intel） */
export const macArch: 'arm64' | 'x64' = process.arch === 'arm64' ? 'arm64' : 'x64'

/** Java 可执行文件名：Windows 用 javaw（无控制台），mac/Linux 用 java */
export const JAVA_BIN = isWin ? 'javaw' : 'java'

/** Java 可执行文件相对 JRE 根目录的路径 */
export const JAVA_REL = isWin ? ['bin', 'javaw.exe'] : ['Contents', 'Home', 'bin', 'java']

/** 应用本体路径（mac 是 .app 内的可执行文件） */
export function appExePath(): string {
  return app.getPath('exe')
}

/** mac 上的 .app 包路径（用于替换/重启） */
export function macAppBundle(): string {
  const exe = appExePath()
  const i = exe.indexOf('.app/')
  return i > 0 ? exe.slice(0, i + 4) : exe
}

/** 用户数据根目录：mac 在 ~/Library/Application Support/RAINBOW MC */
export function defaultUserDataDir(): string {
  return app.getPath('userData')
}

/** 可执行权限（mac 上从 zip/tar 解出来的文件可能没有） */
export function chmodExecutable(file: string): void {
  if (isWin) return
  try {
    const fs = require('fs') as typeof import('fs')
    fs.chmodSync(file, 0o755)
  } catch {
    /* ignore */
  }
}

/** 不需要 Windows 的 powershell 时，返回同义的空结果 */
export function unsupportedOnMac<T>(fallback: T): T {
  return fallback
}

/** 平台标识，用于更新清单 / 构建产物命名 */
export function platformTag(): string {
  if (isMac) return `mac-${macArch}`
  if (isWin) return 'win-x64'
  return `linux-${process.arch}`
}

/** 更新包文件名（避免和 Windows 的 setup.exe 混淆） */
export function updatePackageName(version: string): string {
  if (isMac) return `RAINBOWMC-macOS-${version}-${macArch}.zip`
  return `RAINBOWMC-${version}-setup.exe`
}

/** 统一拼接（给 mac 的 .app 内路径用） */
export function joinPath(...parts: string[]): string {
  return join(...parts)
}
