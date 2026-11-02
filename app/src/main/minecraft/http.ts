import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync, ftruncateSync } from 'fs'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'

/** 长连接池：同一 origin 最多 64 条 socket，避免每次下载重新握手 */

/**
 * 全局在途请求闸门。
 *
 * 为什么需要：一个包有 100+ 个文件，每个 ≥8 MB 会切 8 段，如果只是"每文件 8 段"，
 * 总并发会瞬间冲到 150+，反而被 CDN 限流（实测会出现所有段一起停住）。
 * 这里把「总在途请求」硬限制在 32，让 8 段真正跑满而不是互相打架。
 */
let MAX_INFLIGHT = 32

/** 连续遇到 403/429/断流时下调并发，成功若干次后回升；避免一直撞限流 */
let inflightErrors = 0
let inflightSuccess = 0

function noteResult(ok: boolean): void {
  if (ok) {
    inflightSuccess++
    inflightErrors = 0
    if (inflightSuccess > 20 && MAX_INFLIGHT < 32) {
      MAX_INFLIGHT = 32
      inflightSuccess = 0
    }
  } else {
    inflightErrors++
    inflightSuccess = 0
    if (inflightErrors >= 6 && MAX_INFLIGHT > 16) {
      MAX_INFLIGHT = Math.max(16, MAX_INFLIGHT - 8)
      inflightErrors = 0
      logDl(`连续失败过多，并发降到 ${MAX_INFLIGHT}`)
    }
  }
}

/** 下载失败原因写进 data/logs/download.log，便于事后定位 */
function logDl(msg: string): void {
  try {
    const path = require('path') as typeof import('path')
    const fs = require('fs') as typeof import('fs')
    const dir = require('../paths').paths.logs() as string
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'download.log'), `[${new Date().toISOString()}] ${msg}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}
let inflight = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight++
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  inflight++
}

function release(): void {
  inflight = Math.max(0, inflight - 1)
  const next = waiting.shift()
  if (next) next()
}

const httpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 64,
  maxFreeSockets: 16
})
import { createHash } from 'crypto'
import { dirname } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { app } from 'electron'
import { Transform } from 'stream'

const UA = 'RAINBOWMC-Launcher/0.1.0'

export async function fetchJson<T>(url: string, retries = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return (await res.json()) as T
    } catch (e) {
      lastErr = e
      await sleep(600 * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function fetchText(url: string, retries = 3): Promise<string> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return await res.text()
    } catch (e) {
      lastErr = e
      await sleep(600 * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function sha1File(path: string): string | null {
  try {
    const h = createHash('sha1')
    h.update(require('fs').readFileSync(path))
    return h.digest('hex')
  } catch {
    return null
  }
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export interface DownloadTask {
  /** 下载进度回调：已下载字节 / 总字节（总字节为 0 表示未知） */
  onBytes?: (loaded: number, total: number) => void
  /** 外部取消信号：abort 后立刻中断当前下载 */
  signal?: AbortSignal
  /** 备用下载地址：主地址失败时依次尝试 */
  altUrls?: string[]
  url: string
  dest: string
  sha1?: string
  size?: number
}

export interface DownloadResult {
  ok: boolean
  skipped: boolean
  bytes: number
  error?: string
}

/**
 * 单段 HTTP GET（用 node:https + 长连接池，可精确控制 Range 与空闲超时）。
 * 返回状态码、头、以及可读流；空闲超过 idleMs 没有数据就中断。
 */
async function httpGetRaw(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  idleMs: number
): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  stream: NodeJS.ReadableStream
  abort: () => void
}> {
  await acquire()
  let released = false
  const done = (): void => {
    if (!released) {
      released = true
      release()
    }
  }
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers, agent: httpsAgent }, (res) => {
      res.once('end', done)
      res.once('close', done)
      res.once('error', done)
      resolve({
        status: res.statusCode || 0,
        headers: res.headers as never,
        stream: res,
        abort: () => {
          try {
            res.destroy()
          } catch {
            /* ignore */
          }
          try {
            req.destroy()
          } catch {
            /* ignore */
          }
        }
      })
    })
    let idle = setTimeout(() => {
      try {
        req.destroy(new Error('idle timeout'))
      } catch {
        /* ignore */
      }
    }, idleMs)
    const bump = (): void => {
      clearTimeout(idle)
      idle = setTimeout(() => {
        try {
          req.destroy(new Error('idle timeout'))
        } catch {
          /* ignore */
        }
      }, idleMs)
    }
    req.on('socket', (sock) => {
      sock.on('data', bump)
      sock.once('close', () => clearTimeout(idle))
    })
    req.on('error', (e) => {
      clearTimeout(idle)
      done()
      reject(e)
    })
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('aborted'))
      } else {
        signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true })
      }
    }
    req.end()
  })
}

/** 下载一段 Range 到 tmp 文件（支持从已有字节续传） */
async function fetchSegment(
  url: string,
  tmp: string,
  start: number,
  end: number,
  onBytes: (n: number) => void,
  signal: AbortSignal | undefined
): Promise<void> {
  const expected = end - start + 1
  let have = 0
  try {
    have = existsSync(tmp) ? fileSize(tmp) : 0
  } catch {
    have = 0
  }
  if (have > expected) have = 0
  if (have === expected) {
    onBytes(have)
    return
  }
  const realStart = start + have
  const r = await httpGetRaw(
    url,
    { 'User-Agent': UA, Range: `bytes=${realStart}-${end}`, 'Accept-Encoding': 'identity' },
    signal,
    20000
  )
  if (r.status !== 206) {
    r.abort()
    noteResult(false)
    throw new Error(`分段被拒（HTTP ${r.status}）`)
  }
  await pipeline(
    r.stream as never,
    new Transform({
      transform(chunk: Buffer, _e, cb) {
        onBytes(chunk.length)
        cb(null, chunk)
      }
    }),
    createWriteStream(tmp, { flags: have > 0 ? 'a' : 'w' })
  )
  noteResult(true)
}

/** 单段带重试：失败就从已有字节续传，最多 4 次 */
async function fetchSegmentWithRetry(
  url: string,
  tmp: string,
  start: number,
  end: number,
  onBytes: (n: number) => void,
  signal: AbortSignal | undefined,
  tag: string
): Promise<void> {
  let lastErr = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fetchSegment(url, tmp, start, end, onBytes, signal)
      return
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      logDl(`${tag} 分段 ${start}-${end} 第 ${attempt + 1} 次失败：${lastErr}`)
      await sleep(400 * (attempt + 1))
    }
  }
  throw new Error(`${tag} 分段重试耗尽：${lastErr}`)
}

/**
 * 把已经下好的 .seg 段合并进 .part，并对剩余缺口做「续传式补洞」。
 * 分段整体失败时走这里，绝不从头重下（实测一个 47 MB 的文件曾经被白下两遍）。
 */
async function resumeFromSegments(
  task: DownloadTask,
  urls: string[],
  nSegs: number,
  signal: AbortSignal | undefined
): Promise<boolean> {
  const size = task.size || 0
  if (!size) return false
  const partSize = Math.ceil(size / nSegs)
  const partPath = task.dest + '.part'
  try {
    // 预分配目标文件
    const fd0 = openSync(partPath, 'w')
    try {
      ftruncateSync(fd0, size)
    } finally {
      closeSync(fd0)
    }
    const gaps: { start: number; end: number }[] = []
    let loaded = 0
    for (let i = 0; i < nSegs; i++) {
      const s0 = i * partSize
      const e0 = Math.min(size, s0 + partSize) - 1
      const segPath = `${task.dest}.seg${i}`
      let have = 0
      try {
        have = existsSync(segPath) ? fileSize(segPath) : 0
      } catch {
        have = 0
      }
      const want = e0 - s0 + 1
      const take = Math.min(have, want)
      if (take > 0) {
        const buf = readFileSync(segPath).subarray(0, take)
        const fd = openSync(partPath, 'r+')
        try {
          writeSync(fd, buf, 0, take, s0)
        } finally {
          closeSync(fd)
        }
        loaded += take
      }
      if (take < want) gaps.push({ start: s0 + take, end: e0 })
    }
    task.onBytes?.(loaded, size)
    if (!gaps.length) {
      if (task.sha1 && sha1File(partPath) !== task.sha1) throw new Error('sha1 mismatch')
      renameSync(partPath, task.dest)
      cleanupSegs(task.dest, nSegs)
      return true
    }
    // 补洞：并发 4，每条从缺口起点续传
    let cursor = 0
    const workers = Array.from({ length: Math.min(4, gaps.length) }, async () => {
      for (;;) {
        if (signal?.aborted) throw new Error('aborted')
        const idx = cursor++
        if (idx >= gaps.length) return
        const g = gaps[idx]
        let pos = g.start
        for (let attempt = 0; attempt < 4 && pos <= g.end; attempt++) {
          try {
            const r = await httpGetRaw(
              urls[attempt % urls.length],
              { 'User-Agent': UA, Range: `bytes=${pos}-${g.end}`, 'Accept-Encoding': 'identity' },
              signal,
              20000
            )
            if (r.status !== 206) {
              r.abort()
              throw new Error(`HTTP ${r.status}`)
            }
            const fd = openSync(partPath, 'r+')
            const ws = createWriteStream(partPath, { fd, start: pos, flags: 'r+', autoClose: true })
            await pipeline(
              r.stream as never,
              new Transform({
                transform(chunk: Buffer, _e, cb) {
                  loaded += chunk.length
                  task.onBytes?.(Math.min(loaded, size), size)
                  cb(null, chunk)
                }
              }),
              ws
            )
            pos = g.end + 1
            noteResult(true)
          } catch (e) {
            logDl(`补洞 ${g.start}-${g.end} 第 ${attempt + 1} 次失败：${e instanceof Error ? e.message : e}`)
            await sleep(400 * (attempt + 1))
          }
        }
        if (pos <= g.end) throw new Error('补洞未完成')
      }
    })
    await Promise.all(workers)
    if (task.sha1 && sha1File(partPath) !== task.sha1) throw new Error('sha1 mismatch')
    renameSync(partPath, task.dest)
    cleanupSegs(task.dest, nSegs)
    task.onBytes?.(size, size)
    return true
  } catch (e) {
    logDl(`resumeFromSegments 失败：${e instanceof Error ? e.message : e}`)
    try {
      if (existsSync(partPath)) unlinkSync(partPath)
    } catch {
      /* ignore */
    }
    return false
  }
}

function cleanupSegs(dest: string, n: number): void {
  for (let i = 0; i < n; i++) {
    try {
      const p = `${dest}.seg${i}`
      if (existsSync(p)) unlinkSync(p)
    } catch {
      /* ignore */
    }
  }
}

/** 分段多线程下载：8 段并行，单段失败可续传；整体失败交给 resumeFromSegments 补洞 */
async function downloadSegmented(
  task: DownloadTask,
  urls: string[],
  segs: number
): Promise<DownloadResult | null> {
  const size = task.size || 0
  if (!size || segs < 2) return null
  const n = Math.min(8, Math.max(2, segs))
  const partSize = Math.ceil(size / n)
  let loadedTotal = 0
  let lastEmit = 0
  const emit = (): void => {
    const now = Date.now()
    if (task.onBytes && now - lastEmit > 150) {
      lastEmit = now
      task.onBytes(Math.min(loadedTotal, size), size)
    }
  }
  // 先把已有段计入进度
  for (let i = 0; i < n; i++) {
    try {
      const p = `${task.dest}.seg${i}`
      if (existsSync(p)) loadedTotal += fileSize(p)
    } catch {
      /* ignore */
    }
  }
  emit()
  let segFailed = false
  try {
    await Promise.all(
      Array.from({ length: n }, async (_v, i) => {
        const s0 = i * partSize
        const e0 = Math.min(size, s0 + partSize) - 1
        if (s0 > e0) return
        await fetchSegmentWithRetry(
          urls[i % urls.length],
          `${task.dest}.seg${i}`,
          s0,
          e0,
          (nBytes) => {
            loadedTotal += nBytes
            emit()
          },
          task.signal,
          task.dest.split(/[\\/]/).pop() || 'file'
        )
      })
    )
  } catch (e) {
    segFailed = true
    logDl(`分段失败，转补洞：${e instanceof Error ? e.message : e}`)
  }

  if (!segFailed) {
    try {
      const fd = openSync(task.dest + '.part', 'w')
      try {
        for (let i = 0; i < n; i++) {
          const p2 = `${task.dest}.seg${i}`
          if (!existsSync(p2)) continue
          writeSync(fd, readFileSync(p2))
        }
      } finally {
        closeSync(fd)
      }
      if (task.sha1 && sha1File(task.dest + '.part') !== task.sha1) throw new Error('sha1 mismatch')
      renameSync(task.dest + '.part', task.dest)
      cleanupSegs(task.dest, n)
      task.onBytes?.(size, size)
      return { ok: true, skipped: false, bytes: size }
    } catch (e) {
      logDl(`拼接失败：${e instanceof Error ? e.message : e}`)
      segFailed = true
    }
  }

  // 分段没成：用已下的段补洞，绝不从头重下
  if (segFailed) {
    const ok = await resumeFromSegments(task, urls, n, task.signal)
    if (ok) return { ok: true, skipped: false, bytes: size }
  }
  return null
}

/** 单文件下载：已存在且 sha1 匹配则跳过；大文件分段；失败续传重试 */
export async function downloadOne(task: DownloadTask, retries = 3): Promise<DownloadResult> {
  ensureDir(dirname(task.dest))

  if (existsSync(task.dest) && task.size && fileSize(task.dest) === task.size) {
    if (!task.sha1) return { ok: true, skipped: true, bytes: 0 }
    if (sha1File(task.dest) === task.sha1) return { ok: true, skipped: true, bytes: 0 }
  }

  let lastErr = ''
  const urls = [task.url, ...(task.altUrls ?? [])]

  const mb = (task.size || 0) / 1048576
  if (mb >= 8) {
    const segs = mb > 16 ? 8 : 6
    const seg = await downloadSegmented(task, urls, segs)
    if (seg) return seg
  }

  // 单连接（支持从已有 .part 续传，不从头下）
  for (let i = 0; i < retries; i++) {
    const tmp = task.dest + '.part'
    try {
      let have = 0
      try {
        have = existsSync(tmp) ? fileSize(tmp) : 0
      } catch {
        have = 0
      }
      if (task.size && have >= task.size) have = 0
      const headers: Record<string, string> = { 'User-Agent': UA, 'Accept-Encoding': 'identity' }
      if (have > 0) headers.Range = `bytes=${have}-`
      const target = urls[i % urls.length]
      const r = await httpGetRaw(target, headers, task.signal, 20000)
      if (r.status !== 200 && r.status !== 206) {
        r.abort()
        noteResult(false)
        throw new Error(`HTTP ${r.status}`)
      }
      const total = Number((r.headers['content-length'] as string) || task.size || 0) + have
      let loaded = have
      let lastEmit = 0
      await pipeline(
        r.stream as never,
        new Transform({
          transform(chunk: Buffer, _e, cb) {
            loaded += chunk.length
            const now = Date.now()
            if (task.onBytes && now - lastEmit > 150) {
              lastEmit = now
              task.onBytes(loaded, total || loaded)
            }
            cb(null, chunk)
          }
        }),
        createWriteStream(tmp, { flags: have > 0 ? 'a' : 'w' })
      )
      noteResult(true)
      task.onBytes?.(loaded, total || loaded)
      if (task.sha1 && sha1File(tmp) !== task.sha1) throw new Error('sha1 mismatch')
      renameSync(tmp, task.dest)
      return { ok: true, skipped: false, bytes: fileSize(task.dest) }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      logDl(`单连接失败 ${task.dest.split(/[\\/]/).pop()}：${lastErr}`)
      await sleep(400 * (i + 1))
    }
  }
  return { ok: false, skipped: false, bytes: 0, error: lastErr }
}

export interface PoolOptions {
  /** 整批下载共用取消信号 */
  signal?: AbortSignal
  concurrency?: number
  /** 完成字节数（只在文件完成时跳变） */
  onProgress?: (done: number, total: number, bytes: number) => void
  /** 实时字节数（含在途文件已下载的部分，用于速度/进度条平滑） */
  onLiveBytes?: (bytes: number) => void
  /** 累计进入重试的任务数（用于界面提示「重试中 N 个」，不参与主进度） */
  onRetry?: (count: number) => void
  onError?: (task: DownloadTask, error: string) => void
}

/** 并发下载一批任务，返回失败列表 */
export async function downloadAll(tasks: DownloadTask[], opts: PoolOptions = {}): Promise<DownloadTask[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 16)
  const failed: DownloadTask[] = []
  let done = 0
  let bytes = 0
  let index = 0
  const live = new Map<number, number>()
  const peak = new Map<number, number>()

  let reported = 0
  let retrying = 0
  const reportLive = (): void => {
    if (!opts.onLiveBytes) return
    let sum = bytes
    // 每个任务记它「历史最高已下字节」：重试归零也不会让总进度倒退
    for (const v of peak.values()) sum += v
    if (sum > reported) reported = sum
    opts.onLiveBytes(reported)
  }

  const worker = async (): Promise<void> => {
    while (index < tasks.length) {
      if (opts.signal?.aborted) return
      const myIndex = index++
      const src = tasks[myIndex]
      const task: DownloadTask = {
        ...src,
        signal: opts.signal,
        onBytes: (loaded: number) => {
          live.set(myIndex, loaded)
          const prev = peak.get(myIndex) ?? 0
          if (loaded > prev) peak.set(myIndex, loaded)
          reportLive()
        }
      }
      const r = await downloadOne(task)
      done++
      live.delete(myIndex)
      peak.delete(myIndex)
      if (!r.ok) {
        failed.push(task)
        retrying++
        opts.onError?.(task, r.error || 'unknown')
        opts.onRetry?.(retrying)
      } else {
        bytes += r.bytes
      }
      opts.onProgress?.(done, tasks.length, bytes)
      reportLive()
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return failed
}

export const appDataPath = app.getPath('appData')
