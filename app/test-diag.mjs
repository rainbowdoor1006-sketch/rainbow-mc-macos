/**
 * 诊断规则回归测试：为每条规则喂一段典型日志，检查是否命中预期错误码。
 * 用法：node test-diag.mjs
 */
import { diagnose, DIAG_RULE_COUNT } from './.tmp-diag.mjs'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'diag-'))
const ctx = { allocatedMb: 4096, mods: 564, gpu: 'RTX 5080', gpuVramMb: 16303, totalRamMb: 64898 }

const cases = [
  ['oom-heap', 'E2100', 'java.lang.OutOfMemoryError: Java heap space\n at net.minecraft.client.Minecraft.run'],
  ['oom-meta', 'E2105', 'java.lang.OutOfMemoryError: Metaspace'],
  ['native-thread', 'E2106', 'java.lang.OutOfMemoryError: unable to create new native thread'],
  ['dep', 'E2103', "Missing or unsupported mandatory dependencies: Mod ID: 'citadel', Mod ID: 'geckolib'"],
  ['dup', 'E2107', "Duplicate mod id: 'create'"],
  ['mixin', 'E2103', 'Mixin apply failed tacz.mixins.json:ItemStackMixin -> net.minecraft.world.item.ItemStack'],
  ['forge-ver', 'E2108', 'This mod requires Forge version 47.3.0 or above'],
  ['mc-ver', 'E2109', 'This mod requires Minecraft version 1.20.4'],
  ['optifine', 'E2110', 'OptiFine is incompatible: crash during mixin'],
  ['nofile', 'E2111', 'java.nio.file.NoSuchFileException: mods/foo-1.0.jar'],
  ['gpu', 'E2001', 'EXCEPTION_ACCESS_VIOLATION at nvoglv64.dll+0x1234'],
  ['gl-old', 'E2112', 'OpenGL 3.2 is not supported on this driver'],
  ['glfw', 'E2001', 'GLFW error 65542: Failed to create window'],
  ['vram', 'E2113', 'java.lang.OutOfMemoryError: Failed to allocate a 4096 byte allocation (Native Memory)'],
  ['java-ver', 'E1001', 'java.lang.UnsupportedClassVersionError: Unsupported class file major version 65'],
  ['jvm-args', 'E2114', 'Error: Could not create the Java Virtual Machine'],
  ['main-class', 'E1003', "Error: Could not find or load main class net.minecraft.client.main.Main"],
  ['lib', 'E1003', 'java.lang.module.FindException: Module org.apache.logging.log4j not found, required by cpw.mods'],
  ['corrupt', 'E2115', 'Region file chunks/r.0.0.mca is corrupted'],
  ['newer', 'E2116', 'world was saved in a newer version (Data version 3953)'],
  ['dimension', 'E2117', 'Missing dimension twilightforest:twilight_forest'],
  ['datapack', 'E2118', 'Failed to load datapacks: pack.mcmeta missing in BBSMC汉化包.zip'],
  ['disk', 'E2119', 'java.io.IOException: No space left on device'],
  ['locked', 'E2120', 'java.io.IOException: The process cannot access the file because it is being used by another process'],
  ['defender', 'E2121', 'mods/foo.jar was quarantined: Trojan detected'],
  ['net', 'E2122', 'java.net.ConnectException: connect timed out: raw.githubusercontent.com'],
  ['port', 'E2123', 'java.net.BindException: Address already in use: bind'],
  ['assets', 'E2104', 'Unable to load assets: minecraft/lang/en_us.json'],
  ['unknown', 'E9999', 'some random text without any known signature']
]

let pass = 0
let fail = 0
for (const [name, want, text] of cases) {
  const f = join(dir, name + '.log')
  writeFileSync(f, text, 'utf8')
  const d = diagnose(f, ctx)
  const ok = d.code === want
  if (ok) pass++
  else {
    fail++
    console.log(`✗ ${name}: 期望 ${want}，得到 ${d.code} → ${d.title}`)
  }
}

console.log(`\n规则总数：${DIAG_RULE_COUNT}`)
console.log(`用例：${cases.length} | 通过 ${pass} | 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
