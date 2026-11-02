import { existsSync, mkdirSync, readdirSync, rmSync, chmodSync } from 'fs'
import { join } from 'path'
import { fetchJson, downloadOne, ensureDir } from './http'
import { runtimeDir } from './paths'
import { isMac, isWin, macArch, JAVA_REL } from '../platform'

interface AdoptiumAsset {
  binary: {
    package: {
      link: string
      name: string
      size: number
      checksum?: string
    }
  }
  release_name: string
}

export interface JavaResult {
  path: string
  major: number
  downloaded: boolean
}

/** 平台对应的 Adoptium 参数 */
function adoptiumQuery(major: number): string {
  if (isMac) {
    return (
      `https://api.adoptium.net/v3/assets/latest/${major}/hotspot` +
      `?architecture=${macArch}&image_type=jre&os=mac&vendor=eclipse`
    )
  }
  if (isWin) {
    return (
      `https://api.adoptium.net/v3/assets/latest/${major}/hotspot` +
      `?architecture=x64&image_type=jre&os=windows&vendor=eclipse`
    )
  }
  return (
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot` +
    `?architecture=${process.arch === 'arm64' ? 'aarch64' : 'x64'}&image_type=jre&os=linux&vendor=eclipse`
  )
}

/** 各平台镜像前缀（国内直连 GitHub 基本必挂） */
function mirrorCandidates(major: number, name: string): string[] {
  if (isMac) {
    return [
      `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${major}/jre/${macArch}/mac/${name}`,
      `https://mirror.nju.edu.cn/adoptium/${major}/jre/${macArch}/mac/${name}`
    ]
  }
  if (isWin) {
    return [
      `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${major}/jre/x64/windows/${name}`,
      `https://mirror.nju.edu.cn/adoptium/${major}/jre/x64/windows/${name}`
    ]
  }
  return [
    `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${major}/jre/${process.arch === 'arm64' ? 'aarch64' : 'x64'}/linux/${name}`
  ]
}

async function adoptiumUrl(
  major: number
): Promise<{ url: string; name: string; sha256?: string; size?: number }> {
  const list = await fetchJson<AdoptiumAsset[]>(adoptiumQuery(major))
  if (!list.length) throw new Error(`没有找到 Java ${major} 的 JRE`)
  const pkg = list[0].binary.package
  return { url: pkg.link, name: pkg.name, sha256: pkg.checksum, size: pkg.size }
}

/** 在 JRE 根目录里找 java 可执行文件（mac 是 .app 内的 Contents/Home/bin/java） */
function findJavaExe(root: string): string | null {
  const direct = join(root, ...JAVA_REL)
  if (existsSync(direct)) return direct
  try {
    for (const name of readdirSync(root)) {
      const candidate = join(root, name, ...JAVA_REL)
      if (existsSync(candidate)) return candidate
      // mac 的 JRE 压缩包解出来常见两层目录
      const deeper = join(root, name, name, ...JAVA_REL)
      if (existsSync(deeper)) return deeper
    }
  } catch {
    /* ignore */
  }
  return null
}

export function javaInstallDir(major: number): string {
  return join(runtimeDir(), `jre-${major}`)
}

export function findInstalledJava(major: number): string | null {
  const dir = javaInstallDir(major)
  if (!existsSync(dir)) return null
  return findJavaExe(dir)
}

/** mac 需要给解压出来的 java 加执行权限，否则 spawn 会 EACCES */
function ensureExecutable(file: string): void {
  if (isWin) return
  try {
    chmodSync(file, 0o755)
    // .app 里的 dylib 也要可读，权限一般没问题，这里只保证主程序
  } catch {
    /* ignore */
  }
}

/**
 * 确保存在指定大版本的 Java 运行时。
 * 已安装直接返回；否则从 Adoptium 下载并解压（mac 是 tar.gz，Win 是 zip）。
 */
export async function ensureJava(
  major: number,
  onProgress?: (stage: 'download' | 'extract', pct: number) => void
): Promise<JavaResult> {
  const existing = findInstalledJava(major)
  if (existing) return { path: existing, major, downloaded: false }

  const dest = javaInstallDir(major)
  ensureDir(runtimeDir())
  mkdirSync(dest, { recursive: true })

  onProgress?.('download', 0)
  const { url, name } = await adoptiumUrl(major)
  const pkgPath = join(runtimeDir(), name)

  let lastErr = ''
  let ok = false
  for (const candidate of [...mirrorCandidates(major, name), url]) {
    const isGithub = candidate === url
    const r = await downloadOne({ url: candidate, dest: pkgPath }, isGithub ? 1 : 2)
    if (r.ok) {
      ok = true
      break
    }
    lastErr = r.error || 'unknown'
  }
  if (!ok) {
    throw new Error(
      `Java ${major} 运行时下载失败：${lastErr}。` +
        (isMac
          ? `可以先用 brew install --cask temurin@${major} 装好，再在「设置 → Java 路径」里指定 java。`
          : `可以手动安装 Java ${major}，然后在「设置 → Java 路径」里指定 javaw.exe。`)
    )
  }
  onProgress?.('download', 100)

  onProgress?.('extract', 0)
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) {
    // mac/Linux：用系统 tar（比 node 库稳，也能保留执行权限）
    const { execFileSync } = require('child_process') as typeof import('child_process')
    execFileSync('tar', ['-xzf', pkgPath, '-C', dest], { stdio: 'ignore' })
  } else {
    const AdmZip = require('adm-zip') as typeof import('adm-zip')
    new AdmZip(pkgPath).extractAllTo(dest, true)
  }
  onProgress?.('extract', 100)

  try {
    rmSync(pkgPath, { force: true })
  } catch {
    /* 解压成功即可 */
  }

  const exe = findJavaExe(dest)
  if (!exe) {
    throw new Error(isWin ? 'Java 运行时解压后没有找到 javaw.exe' : 'Java 运行时解压后没有找到 java')
  }
  ensureExecutable(exe)
  return { path: exe, major, downloaded: true }
}
