/** 测量整合包「解析阶段」耗时：读清单 + 解压 overrides/ 到临时目录 */
import AdmZip from 'adm-zip'
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const zipPath = process.argv[2]
if (!zipPath) {
  console.error('用法: node tools/bench-import.mjs <整合包.zip>')
  process.exit(1)
}

const out = join(tmpdir(), 'bench-pack-' + Date.now())
mkdirSync(out, { recursive: true })

const t0 = Date.now()
const zip = new AdmZip(zipPath)
const entries = zip.getEntries()
const t1 = Date.now()

// 清单
let manifest = null
const manEntry = entries.find((e) => e.entryName === 'manifest.json')
const mrEntry = entries.find((e) => e.entryName === 'modrinth.index.json')
if (manEntry) manifest = JSON.parse(manEntry.getData().toString('utf8'))
else if (mrEntry) manifest = JSON.parse(mrEntry.getData().toString('utf8'))
const t2 = Date.now()

// overrides / .minecraft
const targets = entries.filter(
  (e) => !e.isDirectory && (e.entryName.startsWith('overrides/') || e.entryName.startsWith('.minecraft/'))
)
let bytes = 0
for (const e of targets) {
  const rel = e.entryName.replace(/^(overrides|\.minecraft)\//, '')
  const dest = join(out, rel)
  mkdirSync(join(dest, '..'), { recursive: true })
  const buf = e.getData()
  bytes += buf.length
  writeFileSync(dest, buf)
}
const t3 = Date.now()

const mods = manifest
  ? (manifest.files || []).length || (manifest.files || []).length
  : 0

console.log('整合包      :', zipPath)
console.log('压缩包大小  :', (statSync(zipPath).size / 1048576).toFixed(1), 'MB')
console.log('条目总数    :', entries.length)
console.log('清单条目    :', manifest ? JSON.stringify(Object.keys(manifest).slice(0, 5)) : '无清单')
console.log('overrides   :', targets.length, '个文件 /', (bytes / 1048576).toFixed(1), 'MB')
console.log('--- 耗时 ---')
console.log('打开+枚举   :', t1 - t0, 'ms')
console.log('解析清单    :', t2 - t1, 'ms')
console.log('解压 overrides:', t3 - t2, 'ms',
  '→', (bytes / 1048576 / ((t3 - t2) / 1000)).toFixed(1), 'MB/s',
  '→', Math.round(targets.length / ((t3 - t2) / 1000)), '文件/s')
console.log('合计        :', t3 - t0, 'ms')

rmSync(out, { recursive: true, force: true })
