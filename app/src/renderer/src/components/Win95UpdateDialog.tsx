import React, { useEffect, useRef } from 'react'
import { playSoundAndWait } from '@/lib/sounds'

/**
 * Windows 95 风格的更新弹窗。
 *
 * 声音说明：
 *  - 原版 Win95 开机/关机音效是微软版权素材，不能打包分发，
 *    所以默认用 WebAudio 合成「风格接近」的提示音；
 *  - 如果用户把原版 wav 放进 `data\sounds\win95-start.wav` / `win95-stop.wav`，
 *    会优先播放文件（用户自备素材，不随程序分发）。
 */

type Phase = 'download' | 'apply' | 'done'

export interface Win95UpdateState {
  from: string
  to: string
  phase: Phase
  /** 0..1，下载进度 */
  progress?: number
}

const C = {
  face: '#c0c0c0',
  light: '#ffffff',
  shadow: '#808080',
  dark: '#000000',
  navy: '#000080'
}

function bevel(out = true): React.CSSProperties {
  return {
    borderTop: `2px solid ${out ? C.light : C.shadow}`,
    borderLeft: `2px solid ${out ? C.light : C.shadow}`,
    borderRight: `2px solid ${out ? C.shadow : C.light}`,
    borderBottom: `2px solid ${out ? C.shadow : C.light}`
  }
}

export function Win95UpdateDialog({ state }: { state: Win95UpdateState }): React.ReactElement {
  const playedRef = useRef<Phase | null>(null)

  // 进入「应用更新」时放开机音；进入「完成」时放关机音
  useEffect(() => {
    if (playedRef.current === state.phase) return
    playedRef.current = state.phase
    if (state.phase === 'apply') void playSoundAndWait('start')
    if (state.phase === 'done') void playSoundAndWait('stop')
  }, [state.phase])

  const pct = Math.max(0, Math.min(100, Math.round((state.progress ?? (state.phase === 'done' ? 1 : 0)) * 100)))
  const blocks = 32
  const filled = Math.round((pct / 100) * blocks)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
    >
      <div
        style={{
          width: 460,
          background: C.face,
          ...bevel(true),
          boxShadow: '2px 2px 0 #000',
          fontFamily: '"MS Sans Serif", "Microsoft YaHei", Tahoma, sans-serif',
          fontSize: 12
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            background: C.navy,
            color: '#fff',
            padding: '3px 4px 3px 6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontWeight: 700
          }}
        >
          <span>RAINBOW MC 更新程序</span>
          <span
            style={{
              ...bevel(true),
              background: C.face,
              color: C.dark,
              width: 16,
              height: 14,
              lineHeight: '12px',
              textAlign: 'center',
              fontWeight: 700
            }}
          >
            ×
          </span>
        </div>

        <div style={{ padding: '14px 14px 10px' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 30, lineHeight: '32px' }}>💾</div>
            <div style={{ lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                RAINBOW MC 2026 {state.from} 正在更新到 {state.to}
              </div>
              <div style={{ color: '#000' }}>
                {state.phase === 'download' && '正在下载更新文件，请不要关闭电源…'}
                {state.phase === 'apply' && '下载完成，正在安装更新并重启程序…'}
                {state.phase === 'done' && '更新完成，新版本已启动。'}
              </div>
            </div>
          </div>

          {/* 进度条（Win95 分段式） */}
          <div style={{ ...bevel(false), background: '#fff', height: 22, padding: 2, display: 'flex', gap: 2 }}>
            {Array.from({ length: blocks }, (_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: '100%',
                  background: i < filled ? C.navy : 'transparent'
                }}
              />
            ))}
          </div>
          <div style={{ marginTop: 4, textAlign: 'right' }}>{pct}%</div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <div
              style={{
                ...bevel(true),
                background: C.face,
                padding: '4px 22px',
                cursor: 'default',
                opacity: state.phase === 'done' ? 1 : 0.55
              }}
            >
              确定
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
