import { app, shell } from 'electron'
import { isMac, updatePackageName } from './platform'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { spawn } from 'child_process'
import { paths, installRoot } from './paths'
import { verifyManifest } from './minecraft/update'

/** 版本号口径必须与服务端一致：MAJOR * 100 + MINOR * 10 + PATCH */
export function versionCodeOf(version: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!m) return 0
  return Number(m[1]) * 100 + Number(m[2]) * 10 + Number(m[3])
}

export function localVersion(): string {
  // 仅测试用：用环境变量模拟本地版本号，验证「落后 / 超前」两条弹窗路径
  const fake = process.env['RAINBOW_FAKE_LOCAL_VERSION']
  if (fake && /^\d+\.\d+\.\d+$/.test(fake)) return fake
  return app.getVersion()
}

export function localVersionCode(): number {
  return versionCodeOf(localVersion())
}

/** 语义化版本比较：-1 / 0 / 1（比数字 code 更可靠，不受 versionCode 公式影响） */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number(x) || 0)
  const pb = b.split('.').map((x) => Number(x) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}
// 测试 / 自建服务器可用环境变量覆盖（仅影响更新地址，不改变验签逻辑）
export const UPDATE_ENDPOINT =
  process.env['RM_UPDATE_ENDPOINT'] || 'https://rainbowdoor.icu/api/launcher/version'

export interface LatestInfo {
  version: string
  versionCode: number
  downloadUrl: string
  sha256: string
  size: number
  notes?: string
  mandatory?: boolean
  minSupported?: string
  publishedAt?: string
  /** 清单签名（base64，Ed25519），对 version/sha256/size/downloadUrl 计算 */
  sig?: string
}

export type UpdateState = 'older' | 'same' | 'newer' | 'unknown'

export interface CheckResult {
  ok: boolean
  state: UpdateState
  local: { version: string; code: number }
  latest?: LatestInfo
  channel: string
  message?: string
}

function normalizeLatest(raw: Record<string, unknown> | undefined): LatestInfo | null {
  if (!raw) return null
  const version = String(raw.version ?? '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null
  const code = Number(raw.versionCode ?? versionCodeOf(version))
  const url = String(raw.downloadUrl ?? '')
  // 只允许 https；例外：本机回环地址允许 http（本地/自建更新服务）
  const isLoopbackHttp = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)
  if (!/^https:/i.test(url) && !isLoopbackHttp) return null
  return {
    version,
    versionCode: Number.isFinite(code) ? code : versionCodeOf(version),
    downloadUrl: url,
    sha256: String(raw.sha256 ?? '').toLowerCase(),
    size: Number(raw.size ?? 0),
    notes: raw.notes ? String(raw.notes) : undefined,
    mandatory: Boolean(raw.mandatory),
    minSupported: raw.minSupported ? String(raw.minSupported) : undefined,
    publishedAt: raw.publishedAt ? String(raw.publishedAt) : undefined,
    sig: raw.sig ? String(raw.sig) : undefined
  }
}

/** 查询最新版本；任何异常都返回 unknown，绝不抛错、绝不阻塞启动 */
export async function checkForUpdate(channel = 'stable'): Promise<CheckResult> {
  const local = { version: localVersion(), code: localVersionCode() }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(UPDATE_ENDPOINT, {
      headers: {
        'User-Agent': `RAINBOWMC/${local.version} (${process.platform}; ${process.arch})`,
        'X-Launcher-Channel': channel,
        Accept: 'application/json'
      },
      signal: ctrl.signal
    })
    if (!res.ok) return { ok: false, state: 'unknown', local, channel, message: `HTTP ${res.status}` }
    const data = (await res.json()) as Record<string, unknown>
    if (!data.ok) {
      // E9101 = 该渠道没有版本，视为「无需更新」
      return { ok: true, state: 'same', local, channel }
    }
    const latest = normalizeLatest(data.latest as Record<string, unknown> | undefined)
    if (!latest) return { ok: false, state: 'unknown', local, channel, message: '版本信息不完整' }
    // 先验签：清单由服务器返回，sha256 也在里面，同源就等于没有校验。
    // 公钥内置在程序里，攻击者必须拿到私钥才能伪造，服务器被拿下也推不了恶意包。
    const sigErr = verifyManifest({
      version: latest.version,
      sha256: latest.sha256,
      size: latest.size,
      downloadUrl: latest.downloadUrl,
      sig: latest.sig
    })
    if (sigErr) {
      return { ok: false, state: 'unknown', local, channel, message: sigErr }
    }
    // 用语义化版本比较，而不是 versionCode：
    // code 的公式（MAJOR*100+MINOR*10+PATCH）在 0.3.0 这种场景会倒退，
    // 版本号本身比较永远单调，服务端换公式也不受影响。
    const cmp = compareVersion(latest.version, local.version)
    const state: UpdateState = cmp > 0 ? 'older' : cmp < 0 ? 'newer' : 'same'
    return { ok: true, state, local, latest, channel }
  } catch (e) {
    return {
      ok: false,
      state: 'unknown',
      local,
      channel,
      message: e instanceof Error ? e.message : String(e)
    }
  } finally {
    clearTimeout(timer)
  }
}

function sha256File(file: string): string {
  const h = createHash('sha256')
  h.update(readFileSync(file))
  return h.digest('hex')
}

export interface DownloadResult {
  ok: boolean
  path?: string
  message?: string
}

/** 下载安装包到临时目录，校验 sha256；带进度回调 */
export async function downloadInstaller(
  latest: LatestInfo,
  onProgress?: (loaded: number, total: number) => void
): Promise<DownloadResult> {
  const dir = join(paths.cache(), 'updates')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `RAINBOWMC-${latest.version}-setup.exe`)
  try {
    if (existsSync(file) && latest.size && statSync(file).size === latest.size) {
      if (!latest.sha256 || sha256File(file) === latest.sha256) return { ok: true, path: file }
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000)
    const resumeFrom = existsSync(file) ? statSync(file).size : 0
    const headers: Record<string, string> = { 'User-Agent': `RAINBOWMC/${localVersion()}` }
    if (resumeFrom > 0 && latest.size > resumeFrom) headers.Range = `bytes=${resumeFrom}-`
    const res = await fetch(latest.downloadUrl, { headers, signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok || !res.body) return { ok: false, message: `下载失败 HTTP ${res.status}` }
    const total = Number(res.headers.get('content-length') || latest.size || 0) + (res.status === 206 ? resumeFrom : 0)
    const out = createWriteStream(file, { flags: res.status === 206 ? 'a' : 'w' })
    let loaded = res.status === 206 ? resumeFrom : 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.write(Buffer.from(value))
      loaded += value.length
      onProgress?.(loaded, total || latest.size || 0)
    }
    await new Promise<void>((resolve) => out.end(resolve))
    if (latest.sha256 && sha256File(file) !== latest.sha256) {
      try {
        unlinkSync(file)
      } catch {
        /* ignore */
      }
      return { ok: false, message: '安装包校验失败（sha256 不匹配），已删除' }
    }
    return { ok: true, path: file }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 应用更新：写一个「守卫脚本」→ 启动器自己退出 → 脚本等进程真的没了才装 →
 * 装完（成功或失败）都尝试把启动器拉起来。
 *
 * 为什么不能像以前那样「spawn 安装器 + 1.5 秒后 self.exit」：
 *  1. 安装器（NSIS）会先跑旧卸载器删程序文件，此时启动器还在跑，文件被占用；
 *  2. 目录一旦不一致（比如 /D 传错），旧卸载器删的其实是"注册表里那个目录"，
 *     会出现「原来的应用被删了、新目录没装成」的双输局面（2026-10-31 已复现）。
 * 所以：先退出、再安装、装完自检、失败也要把用户拉回来。
 */
export interface ApplyResult {
  ok: boolean
  message?: string
}

/** 读注册表里记录的安装位置（安装器按它决定"上一份装在哪"） */
function registeredInstallDir(): string {
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process')
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RAINBOW MC', '/v', 'InstallLocation'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    )
    const m = out.match(/InstallLocation\s+REG_SZ\s+(.+)/)
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

/** 启动器可执行文件名（用于判断"进程是否真的退干净了"） */
const APP_EXE_NAME = "RAINBOW MC.exe"

/**
 * 应用更新。
 *
 * 目标时序（用户要求）：
 *   下载完成 → **弹出 Win95 风格安装窗口** → 窗口里跑静默安装（启动器退出，让文件解锁）
 *   → 安装完成后窗口停留几秒（播完结束音）→ 关闭窗口 → 拉起新版本启动器
 *
 * 所以这里不自己画界面，而是交给一个 **PowerShell + WinForms** 的小窗口：
 *   · 只有这一个窗口，安装器本身用 -WindowStyle Hidden，不再弹一堆黑框；
 *   · 声音由这个窗口播放（data\sounds 下的 wav）；
 *   · 窗口关闭后才启动启动器，不会出现「先拉起启动器再弹窗」。
 */

function psQuote(v: string): string {
  return v.replace(/'/g, "''")
}

/** 生成 HTA 安装窗口（HTML + CSS 画 Win95 界面，无控制台、无 PowerShell 窗口） */
function buildHta(installerPath: string, dir: string, exe: string, from: string, to: string): string {
  const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const jsStr = (v: string): string => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

  const startWav = `${dir}\\data\\sounds\\win95-start.wav`
  const stopWav = `${dir}\\data\\sounds\\win95-stop.wav`
  const installArgs = `/S /KEEPDATA${dir ? ` /D=${dir}` : ''}`
  const cmd = `"${installerPath}" ${installArgs}`

  const html = `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta http-equiv="X-UA-Compatible" content="IE=9" />
<title>RAINBOW MC 更新程序</title>
<hta:application id="rmUpdate" border="none" caption="no" showintaskbar="yes" scroll="no" singleinstance="yes" contextmenu="no" selection="no" />
<style>
  html,body{margin:0;padding:0;background:#c0c0c0;overflow:hidden;
    font-family:"MS Sans Serif","Microsoft YaHei",Tahoma,sans-serif;font-size:12px;cursor:default}
  .win{width:466px;height:186px;background:#c0c0c0;border-top:2px solid #fff;border-left:2px solid #fff;
    border-right:2px solid #808080;border-bottom:2px solid #808080}
  .title{height:24px;background:#000080;color:#fff;font-weight:bold;font-size:12px;line-height:24px;padding-left:6px;position:relative}
  .title .x{position:absolute;right:4px;top:3px;width:16px;height:14px;background:#c0c0c0;color:#000;
    border-top:1px solid #fff;border-left:1px solid #fff;border-right:1px solid #808080;border-bottom:1px solid #808080;
    text-align:center;line-height:12px;font-weight:bold}
  .body{padding:12px 14px 0 14px}
  .l1{font-weight:bold;margin-bottom:4px}
  .l2{margin-bottom:10px}
  .bar{height:22px;background:#fff;border-top:2px solid #808080;border-left:2px solid #808080;
    border-right:2px solid #fff;border-bottom:2px solid #fff;padding:2px;overflow:hidden}
  .seg{float:left;width:9px;height:14px;margin-right:3px;background:#fff}
  .seg.on{background:#000080}
  .pct{text-align:right;margin-top:3px;font-size:11px}
</style>
</head>
<body onload="boot()">
<bgsound id="snd" src="${esc(startWav)}" />
<div class="win" id="win" style="display:none">
  <div class="title">RAINBOW MC 更新程序<div class="x">×</div></div>
  <div class="body">
    <div class="l1" id="l1">RAINBOW MC 2026 ${esc(from)} 正在更新到 ${esc(to)}</div>
    <div class="l2" id="l2">正在安装更新文件，请不要关闭电源…</div>
    <div class="bar" id="bar"></div>
    <div class="pct" id="pct">0%</div>
  </div>
</div>
<script>
var INST = '${jsStr(installerPath)}';
var EXE  = '${jsStr(exe)}';
var WAV_STOP = '${jsStr(stopWav)}';
var ARGS = '${jsStr(installArgs)}';
var SEGS = 32;
var pct = 0, running = true, done = false;

function el(id){ return document.getElementById(id); }

function drawBar(){
  var bar = el('bar'), html = '', i;
  var on = Math.round(pct / 100 * SEGS);
  for (i = 0; i < SEGS; i++) {
    html += '<div class="seg' + (i < on ? ' on' : '') + '"></div>';
  }
  bar.innerHTML = html;
  el('pct').innerHTML = Math.round(pct) + '%';
}

function tick(){
  if (running && pct < 90) { pct += 1.5; drawBar(); }
  setTimeout(tick, 120);
}

function playStop(){
  try {
    var b = document.createElement('bgsound');
    b.src = WAV_STOP;
    document.body.appendChild(b);
  } catch (e) {}
}

function boot(){
  // 居中显示
  window.resizeTo(474, 194);
  var x = (screen.availWidth - 474) / 2, y = (screen.availHeight - 194) / 2;
  window.moveTo(x, y);
  el('win').style.display = 'block';
  drawBar();
  tick();
  // 抢焦点，确保窗口在最前面（HTA 没有 alwaysOnTop）
  try { window.focus(); self.focus(); } catch (e) {}

  // 等旧进程退干净（最多 20 秒），这段时间窗口一直显示
  var waited = 0;
  var probe = setInterval(function(){
    waited += 500;
    if (waited > 20000) { clearInterval(probe); runInstall(); }
  }, 500);

  // 旧启动器退出后立刻装（用 cmd 探测，静默）
  var timer2 = setInterval(function(){
    var running = shell().Run('cmd /c tasklist /FI "IMAGENAME eq RAINBOW MC.exe" /NH | find "RAINBOW MC.exe"', 0, true);
    if (running !== 0) {
      clearInterval(probe); clearInterval(timer2);
      runInstall();
    }
  }, 700);
}

function shell(){
  if (!window.__sh) { window.__sh = new ActiveXObject('WScript.Shell'); }
  return window.__sh;
}

function runInstall(){
  if (done) { return; }
  done = true;
  el('l2').innerHTML = '正在安装更新文件，请不要关闭电源…';
  var cmd = '"' + INST + '"' + ' ' + ARGS;
  var code = 1;
  try { code = shell().Run(cmd, 0, true); } catch (e) { code = 1; }

  running = false;
  pct = 100;
  drawBar();

  if (code === 0) {
    el('l1').innerHTML = 'RAINBOW MC 2026 已更新到 ${jsStr(to)}';
    el('l2').innerHTML = '更新完成，正在启动启动器…';
    playStop();
    // 先让窗口消失，再拉起启动器（避免先起启动器、后关窗）
    setTimeout(function(){ el('win').style.display = 'none'; }, 3000);
    setTimeout(function(){ launch(); }, 3350);
    setTimeout(function(){ try { window.close(); } catch (e) {} }, 4200);
  } else {
    el('l1').innerHTML = '更新没有完成';
    el('l2').innerHTML = '已保留原版本，正在重新打开启动器…';
    setTimeout(function(){ el('win').style.display = 'none'; }, 2000);
    setTimeout(function(){ launch(); }, 2350);
    setTimeout(function(){ try { window.close(); } catch (e) {} }, 3200);
  }
}

function launch(){
  try { shell().Run('"' + EXE + '"', 1, false); } catch (e) {}
  setTimeout(function(){ window.close(); }, 400);
}
</script>
</body>
</html>
`

  // mshta/IE 按 ANSI 读文件，直接把中文写进去会乱码（实测）。
  // 这里把非 ASCII 字符全部转成 HTML 数值实体，任何编码下都能正确显示。
  return html.replace(/[^\x00-\x7F]/g, (ch) => '&#' + ch.charCodeAt(0) + ';')
}

export function runInstaller(installerPath: string, fromVersion = '', toVersion = ''): ApplyResult {
  // macOS：ad-hoc 签名版不能自己替换 .app（会破坏签名），
  // 改成打开下载页，用户把新的拖进「应用程序」即可。数据在 ~/Library/Application Support，不受影响。
  if (isMac) {
    void shell.openExternal(process.env['RM_UPDATE_PAGE'] || 'https://rainbowdoor.icu/download/')
    return {
      ok: true,
      message: `已打开下载页，请下载 ${updatePackageName(toVersion || '')} 并拖入「应用程序」完成更新`
    }
  }
  const dir = String(installRoot() ?? '')
  const registered = registeredInstallDir()
  if (registered && dir && registered.toLowerCase() !== dir.toLowerCase()) {
    return {
      ok: false,
      message: `安装目录与注册表不一致（注册表：${registered}，当前：${dir}），已取消以免误删。请手动安装一次修复。`
    }
  }
  if (!existsSync(installerPath)) return { ok: false, message: '安装包不存在，请重新下载' }

  try {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    fs.mkdirSync(paths.cache(), { recursive: true })
    const htaPath = path.join(paths.cache(), 'update-window.hta')
    const exe = app.getPath('exe')

    fs.writeFileSync(
      htaPath,
      buildHta(installerPath, dir, exe, fromVersion || app.getVersion(), toVersion),
      'utf8'
    )

    const { spawn } = require('child_process') as typeof import('child_process')
    spawn('mshta.exe', [htaPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export function noteUpdatedLaunch(): { from?: string; to?: string } | null {
  try {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const p = path.join(paths.cache(), 'updated.json')
    if (!fs.existsSync(p)) return null
    // 剥离 BOM：PowerShell/记事本写出来的 JSON 带 BOM，会让 JSON.parse 直接抛错
    const raw = String(fs.readFileSync(p, 'utf8')).replace(/^\uFEFF/, '')
    const j = JSON.parse(raw) as { from?: string; to?: string }
    fs.unlinkSync(p)
    return j
  } catch {
    return null
  }
}

/** 记录"即将更新"的标记，下次启动就能知道从哪个版本升上来的 */
export function markUpdatePending(to: string): void {
  try {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const dir = paths.cache()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'updated.json'),
      JSON.stringify({ from: app.getVersion(), to, at: Date.now() }),
      'utf8'
    )
  } catch {
    /* ignore */
  }
}

/**
 * 安装完成后重启自己。
 * 不能只依赖 app.relaunch()：exe 刚被安装程序替换，文件句柄可能还没释放，
 * 所以这里用 detached spawn 直接拉起新进程，再退出当前进程。
 */
export function restartAfterUpdate(): void {
  const exe = app.getPath('exe')
  // 交给 cmd 延迟 3 秒再 start：确保安装程序彻底释放 exe / app.asar 的文件句柄，
  // 否则新进程会因为文件被占用而立刻退出。
  const cmd = `ping -n 4 127.0.0.1 >nul & start "" "${exe}"`
  try {
    spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    app.relaunch()
  }
  setTimeout(() => app.exit(0), 800)
}
