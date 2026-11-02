/**
 * 核对整合包 manifest 里声明的文件，是否都在实例的 mods 目录里。
 * 用法：node tools\check-pack-missing.mjs "<整合包.zip>" "<实例目录>"
 */
import AdmZip from './node_modules/adm-zip/adm-zip.js'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const zipPath = process.argv[2]
const instDir = process.argv[3]
if (!zipPath || !instDir) {
  console.error('用法: node tools\\check-pack-missing.mjs <整合包.zip> <实例目录>')
  process.exit(1)
}

const zip = new AdmZip(zipPath)
const man = JSON.parse(zip.getEntry('manifest.json').getData().toString('utf8'))
const files = (man.files || []).filter((f) => f.projectID && f.fileID)

const modsDir = join(instDir, 'mods')
const onDisk = new Map()
for (const f of readdirSync(modsDir)) {
  if (f.toLowerCase().endsWith('.jar')) onDisk.set(f.toLowerCase(), f)
}

// 按 projectID 分组，减少请求
const byProject = new Map()
for (const f of files) {
  if (!byProject.has(f.projectID)) byProject.set(f.projectID, [])
  byProject.get(f.projectID).push(f.fileID)
}
console.log('manifest 文件数:', files.length, '| 涉及项目:', byProject.size, '| 磁盘 jar:', onDisk.size)

const cacheDir = 'D:\\APP\\RAINBOWMC\\data\\cache\\cfwidget'

async function widget(pid) {
  // 先读启动器缓存
  const cf = join(cacheDir, `${pid}.json`)
  if (existsSync(cf)) {
    try {
      const j = JSON.parse(readFileSync(cf, 'utf8'))
      if (j.files?.length) return j.files
    } catch {}
  }
  try {
    const res = await fetch(`https://api.cfwidget.com/${pid}`, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return []
    const j = await res.json()
    return j.files || []
  } catch {
    return []
  }
}
import { readFileSync } from 'node:fs'

const pids = [...byProject.keys()]
const resolved = new Map() // fileId -> name
let done = 0
const CONC = 12
let idx = 0
await Promise.all(
  Array.from({ length: CONC }, async () => {
    for (;;) {
      const k = idx++
      if (k >= pids.length) return
      const pid = pids[k]
      const want = new Set(byProject.get(pid))
      const list = await widget(pid)
      for (const f of list) {
        if (want.has(f.id)) resolved.set(f.id, f.name)
      }
      done++
      if (done % 40 === 0) console.log(`  已解析 ${done}/${pids.length} 个项目`)
    }
  })
)

const missing = []
const unknown = []
for (const f of files) {
  const name = resolved.get(f.fileID)
  if (!name) {
    unknown.push(f)
    continue
  }
  if (!onDisk.has(name.toLowerCase())) missing.push({ ...f, name })
}

console.log('\n=== 结果 ===')
console.log('已解析到文件名:', resolved.size, '/', files.length)
console.log('磁盘上缺失:', missing.length)
console.log('无法解析（cfwidget 没这个文件，可能太旧）:', unknown.length)
if (missing.length) {
  console.log('\n缺失文件：')
  for (const m of missing.slice(0, 40)) console.log(`  · ${m.name}  (project ${m.projectID} / file ${m.fileID})`)
}
if (unknown.length) {
  console.log('\n无法解析的文件 ID：')
  for (const u of unknown.slice(0, 40)) console.log(`  · project ${u.projectID} / file ${u.fileID}`)
}
