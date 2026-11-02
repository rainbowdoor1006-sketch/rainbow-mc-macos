/**
 * 更新音效：优先播放 data\sounds\ 下的 wav；没有就用 WebAudio 合成一段钢琴味提示音。
 * 提供「播放并等待结束」的 Promise，便于界面卡住时序（音效没播完不显示完成）。
 */

export type SoundKind = 'start' | 'stop'

/** 无文件时的兜底时长（毫秒），与生成脚本里的长度一致 */
export const SOUND_FALLBACK_MS: Record<SoundKind, number> = {
  start: 6600,
  stop: 2600
}

function fileFor(kind: SoundKind): string {
  return kind === 'start' ? 'win95-start.wav' : 'win95-stop.wav'
}

/** 钢琴味：几个音叠加，快起音 + 指数衰减 */
function synth(kind: SoundKind): { ctx: AudioContext; done: Promise<void> } {
  const ctx = new AudioContext()
  const master = ctx.createGain()
  master.gain.value = 0.6
  master.connect(ctx.destination)

  const notes: [number, number, number][] =
    kind === 'start'
      ? [
          [261.63, 0.0, 1.6],
          [329.63, 0.14, 1.5],
          [392.0, 0.28, 1.5],
          [523.25, 0.42, 1.9],
          [130.81, 0.42, 2.2],
          [659.25, 1.9, 0.9],
          [783.99, 2.0, 0.85]
        ]
      : [
          [523.25, 0.0, 0.95],
          [392.0, 0.28, 0.95],
          [329.63, 0.56, 1.0],
          [261.63, 0.86, 1.5],
          [130.81, 0.9, 1.2]
        ]

  const total = (SOUND_FALLBACK_MS[kind] - 200) / 1000
  for (const [f, at, dur] of notes) {
    const t0 = ctx.currentTime + at
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(0.28, t0 + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur)
    g.connect(master)
    // 基频 + 二次泛音（略拉伸）→ 听起来更像钢琴
    for (const [mult, w] of [
      [1, 1],
      [2.003, 0.42],
      [3.01, 0.18],
      [4.02, 0.08]
    ] as [number, number][]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f * mult
      const og = ctx.createGain()
      og.gain.value = w
      o.connect(og).connect(g)
      o.start(t0)
      o.stop(t0 + dur + 0.05)
    }
  }

  const done = new Promise<void>((resolve) => {
    setTimeout(() => {
      try {
        void ctx.close()
      } catch {
        /* ignore */
      }
      resolve()
    }, total * 1000)
  })
  return { ctx, done }
}

/** 播放指定音效，并等到它真正播完 */
export async function playSoundAndWait(kind: SoundKind): Promise<void> {
  let root = ''
  try {
    const p = await window.api.getPaths()
    root = p.root
  } catch {
    root = ''
  }

  if (root) {
    const url = `rainbow://local/${encodeURIComponent(`${root}\\sounds\\${fileFor(kind)}`)}`
    try {
      const audio = new Audio(url)
      audio.volume = 0.85
      const waited = await Promise.race([
        audio.play().then(
          () =>
            new Promise<'played'>((resolve) => {
              audio.onended = () => resolve('played')
              audio.onerror = () => resolve('played')
            })
        ),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), SOUND_FALLBACK_MS[kind] + 1500))
      ])
      if (waited === 'played') return
    } catch {
      /* 文件不可用，走合成 */
    }
  }

  const { done } = synth(kind)
  await done
}
