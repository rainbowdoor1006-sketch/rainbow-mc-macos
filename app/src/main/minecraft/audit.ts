import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 整合包安装后的审计：文件是否齐全、是否放在了正确的目录。
 *
 * 判断"这是什么"不靠文件名，靠 zip 内部结构：
 *   有 shaders/          → 光影（应放 shaderpacks）
 *   有 pack.mcmeta+assets → 资源包（应放 resourcepacks）
 *   有 META-INF/mods.toml 或 fabric.mod.json → 模组（应放 mods）
 * 文件名只作为最后兜底（像 Photon.zip / BSL.zip 这种名字里没有 shader 的包，
 * 过去就是靠名字判断才被丢进 resourcepacks）。
 */

export type PackKind = 'shader' | 'resourcepack' | 'mod' | 'unknown'

export interface AuditIssue {
  kind: 'missing' | 'size' | 'misplaced' | 'shader-config' | 'extract'
  file: string
  detail: string
}

export interface AuditResult {
  ok: boolean
  counts: { mods: number; shaderpacks: number; resourcepacks: number }
  issues: AuditIssue[]
  /** 光影配置里指定但文件不存在的光影名 */
  shaderConfigMissing?: string
  message: string
}

function zipKind(file: string): PackKind {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require('adm-zip') as new (p: string) => {
      getEntries(): { entryName: string }[]
    }
    const zip = new AdmZip(file)
    const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'))
    const has = (p: string): boolean => names.some((n) => n.startsWith(p))
    if (has('shaders/')) return 'shader'
    if (names.includes('pack.mcmeta') && has('assets/minecraft/')) return 'resourcepack'
    if (names.includes('META-INF/mods.toml') || names.includes('fabric.mod.json')) return 'mod'
    if (names.includes('pack.mcmeta')) return 'resourcepack'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 名字兜底：没有内部结构可读时用 */
function nameHint(file: string): PackKind {
  const n = file.toLowerCase()
  if (/shader|complementary|bsl|photon|rethink|seus|kappa|bliss|iteration|chocapic|makeup|sildur/.test(n)) return 'shader'
  if (/resourcepack|resource_pack|-rp-|translation|语言|翻译/.test(n)) return 'resourcepack'
  return 'unknown'
}

function classify(file: string): PackKind {
  const k = zipKind(file)
  return k === 'unknown' ? nameHint(file) : k
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => {
      try {
        return statSync(join(dir, f)).isFile()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

/** 读出 oculus/iris 配置里指定的光影文件名 */
function shaderPackSetting(instDir: string): string {
  for (const name of ['oculus.properties', 'iris.properties']) {
    const p = join(instDir, 'config', name)
    if (!existsSync(p)) continue
    try {
      const txt = require('fs').readFileSync(p, 'utf8') as string
      const m = txt.match(/^\s*shaderPack\s*=\s*(.+)$/m)
      if (m) return m[1].trim()
    } catch {
      /* ignore */
    }
  }
  return ''
}

export function auditInstance(instDir: string): AuditResult {
  const issues: AuditIssue[] = []
  const mods = listFiles(join(instDir, 'mods'))
  const shaders = listFiles(join(instDir, 'shaderpacks'))
  const resources = listFiles(join(instDir, 'resourcepacks'))

  // mods：只应有 jar
  for (const f of mods) {
    const n = f.toLowerCase()
    if (n.endsWith('.jar') || n.endsWith('.jar.disabled')) continue
    const p = join(instDir, 'mods', f)
    if (n.endsWith('.zip')) {
      const k = classify(p)
      issues.push({
        kind: 'misplaced',
        file: `mods/${f}`,
        detail: k === 'shader' ? '这是光影，应放到 shaderpacks' : k === 'resourcepack' ? '这是资源包，应放到 resourcepacks' : 'zip 不该放在 mods'
      })
    } else {
      issues.push({ kind: 'misplaced', file: `mods/${f}`, detail: '非 jar 文件不该放在 mods' })
    }
  }

  // shaderpacks：应是光影
  for (const f of shaders) {
    const n = f.toLowerCase()
    if (n.endsWith('.jar') || n.endsWith('.jar.disabled')) {
      issues.push({ kind: 'misplaced', file: `shaderpacks/${f}`, detail: 'jar 是模组，应放到 mods' })
      continue
    }
    if (!n.endsWith('.zip')) continue
    const k = classify(join(instDir, 'shaderpacks', f))
    if (k === 'resourcepack') {
      issues.push({ kind: 'misplaced', file: `shaderpacks/${f}`, detail: '这是资源包，应放到 resourcepacks' })
    } else if (k === 'mod') {
      issues.push({ kind: 'misplaced', file: `shaderpacks/${f}`, detail: '这是模组 jar（zip 伪装），应放到 mods' })
    }
  }

  // resourcepacks：不应有光影/jar
  for (const f of resources) {
    const n = f.toLowerCase()
    if (n.endsWith('.jar') || n.endsWith('.jar.disabled')) {
      issues.push({ kind: 'misplaced', file: `resourcepacks/${f}`, detail: 'jar 是模组，应放到 mods' })
      continue
    }
    if (!n.endsWith('.zip')) continue
    const k = classify(join(instDir, 'resourcepacks', f))
    if (k === 'shader') {
      issues.push({ kind: 'misplaced', file: `resourcepacks/${f}`, detail: '这是光影，应放到 shaderpacks' })
    }
  }

  // 光影配置一致性：配置里写了但文件不存在 → 游戏里会"没有光影"
  let shaderConfigMissing: string | undefined
  const conf = shaderPackSetting(instDir)
  if (conf) {
    const inShader = existsSync(join(instDir, 'shaderpacks', conf))
    const inRes = existsSync(join(instDir, 'resourcepacks', conf))
    if (!inShader && !inRes) {
      shaderConfigMissing = conf
      issues.push({
        kind: 'shader-config',
        file: `config/oculus.properties`,
        detail: `指定的光影「${conf}」不存在（shaderpacks 里没有这个文件）`
      })
    }
  }

  const counts = { mods: mods.length, shaderpacks: shaders.length, resourcepacks: resources.length }
  const bad = issues.length
  const parts = [
    `mods ${counts.mods}`,
    `光影 ${counts.shaderpacks}`,
    `资源包 ${counts.resourcepacks}`,
    bad ? `发现 ${bad} 处问题` : '文件位置正常'
  ]
  return {
    ok: bad === 0,
    counts,
    issues,
    shaderConfigMissing,
    message: parts.join(' · ')
  }
}
