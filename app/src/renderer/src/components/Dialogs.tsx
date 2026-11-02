import React, { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import { CATEGORY_NAME, lookupError } from '@shared/errors'
import { IconFolder, IconWarn } from './Icons'

/** 选择已安装版本 → 新建项目 */
export function ProjectPicker({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [installed, setInstalled] = useState<{ id: string; type: string }[]>([])
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.mc.installed().then((list) => {
      setInstalled(list)
      if (list.length) {
        setSelected(list[0].id)
        setName(list[0].id)
      }
    })
  }, [])

  const create = async (): Promise<void> => {
    if (!selected) return
    setBusy(true)
    await window.api.project.create(name || selected, selected, 'vanilla')
    setBusy(false)
    onCreated()
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h2>{t('project.create')}</h2>
        {installed.length === 0 ? (
          <p>{t('project.emptyInstalled')}</p>
        ) : (
          <>
            <div className="field">
              <label>{t('home.mcVersion')}</label>
              <select className="select" value={selected} onChange={(e) => setSelected(e.target.value)}>
                {installed.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id} · {v.type}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t('home.projectName')}</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!selected || busy} onClick={() => void create()}>
            {t('common.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 离线登录：必须经过社团授权 */
export function LoginOffline({
  mockMode,
  onClose,
  onDone
}: {
  mockMode: boolean
  onClose: () => void
  onDone: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    // 2026-10-20：授权改为跳转浏览器，不再传账号密码
    const r = await window.api.account.offlineLogin(name.trim(), '', '')
    setBusy(false)
    if (!r.ok) {
      setError(r.message || r.errorCode || 'error')
      return
    }
    onDone()
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h2>{t('accounts.club')}</h2>
        <p style={{ marginBottom: 16 }}>{t('accounts.clubSsoHint')}</p>
        {mockMode && (
          <div className="hint-banner" style={{ marginBottom: 14 }}>
            {t('accounts.clubMock')}
          </div>
        )}
        <div className="field">
          <label>{t('accounts.offlineName')}</label>
          <input
            className="input"
            value={name}
            placeholder="Steve"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <span className="hint">{t('accounts.nameRule')} · {t('accounts.clubNameHint')}</span>
        </div>
        {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? t('accounts.waitingBrowser') : t('accounts.authorizeAndLogin')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 微软正版登录：打开浏览器走微软授权页 */
export function MsLogin({
  onClose,
  onDone
}: {
  hasClientId?: boolean
  onClose: () => void
  onDone: () => void
  onGoSettings?: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState<{ userCode: string; uri: string } | null>(null)
  const [copied, setCopied] = useState(false)

  React.useEffect(() => {
    const off = window.api.account.onDeviceCode((p) => {
      setCode({ userCode: p.userCode, uri: p.uri })
      // 拿到代码立刻复制到剪贴板并提示
      void window.api.copyText(p.userCode).then(
        () => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2600)
        },
        () => setCopied(false)
      )
    })
    return off
  }, [])

  const start = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setCode(null)
    const r = await window.api.account.msLogin()
    setBusy(false)
    if (!r.ok) setError(r.message || r.errorCode || 'error')
    else onDone()
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h2>{t('accounts.microsoft')}</h2>
        <p>{t('accounts.msFlow')}</p>

        {busy && code && (
          <div className="card tight" style={{ marginTop: 12, textAlign: 'center', borderColor: 'rgba(127,182,155,.4)' }}>
            <div className="dim" style={{ fontSize: 11.5, marginBottom: 8 }}>
              {t('accounts.deviceCodeHint')}
            </div>
            <div className="mono" style={{ fontSize: 26, letterSpacing: '0.22em', fontWeight: 700, color: 'var(--accent)' }}>
              {code.userCode}
            </div>
            {copied && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ok)' }}>✔ {t('accounts.codeCopied')}</div>
            )}
            <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
              {code.uri}
            </div>
          </div>
        )}
        {busy && !code && <p className="dim">{t('accounts.waitingBrowser')}</p>}
        {error && <div style={{ color: 'var(--err)', fontSize: 12.5, marginTop: 12, lineHeight: 1.7 }}>{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={() => void start()} disabled={busy}>
            {busy ? t('accounts.waitingBrowser') : t('accounts.openBrowser')}
          </button>
        </div>
      </div>
    </div>
  )
}
export function LaunchError({
  errorCode,
  message,
  diagnosis,
  onClose,
  onOpenLogs
}: {
  errorCode: string
  message?: string
  diagnosis?: {
    code: string
    category: string
    title: string
    confidence: 'high' | 'medium' | 'low'
    evidence: string[]
    steps: string[]
    facts: string[]
  } | null
  onClose: () => void
  onOpenLogs: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const info = lookupError(errorCode)
  const [copied, setCopied] = useState(false)

  const copyAll = async (): Promise<void> => {
    const text = [
      `错误码：${errorCode}${info ? '（' + CATEGORY_NAME[info.category] + '）' : ''}`,
      diagnosis ? `判定：${diagnosis.title}` : info ? `类型：${info.title}` : '',
      diagnosis && diagnosis.facts.length ? '关键数据：' + diagnosis.facts.join('；') : '',
      diagnosis && diagnosis.evidence.length ? '日志证据：' + diagnosis.evidence.join(' | ') : '',
      message ? `详情：${message}` : '',
      info ? '可能原因：' + info.reasons.join('；') : '',
      (diagnosis?.steps ?? info?.steps ?? []).map((x, i) => `${i + 1}. ${x}`).join(' ')
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 640, maxHeight: '86vh', overflowY: 'auto' }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 6 }}>
          <span className="tag" style={{ background: 'rgba(255,107,129,.14)', color: 'var(--err)' }}>
            {info ? CATEGORY_NAME[info.category] : '未分类'}
          </span>
          <span className="dim mono" style={{ fontSize: 11.5 }}>
            {errorCode}
          </span>
        </div>

        <h2 style={{ marginBottom: 6 }}>{diagnosis?.title || (info ? info.title : t('launch.errorTitle'))}</h2>
        {message && (
          <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.8, wordBreak: 'break-all' }}>
            {message}
          </p>
        )}

        {diagnosis && (
          <>
            <div className="card tight" style={{ marginTop: 12, borderColor: 'rgba(127,182,155,.5)' }}>
              <div className="card-title">关键数据</div>
              {diagnosis.facts.length > 0 && (
                <ul className="dim" style={{ fontSize: 12, lineHeight: 1.85, paddingLeft: 18, marginTop: 6 }}>
                  {diagnosis.facts.map((f2, i2) => (
                    <li key={i2}>{f2}</li>
                  ))}
                </ul>
              )}
            </div>

            {diagnosis.evidence.length > 0 && (
              <div className="card tight" style={{ marginTop: 10 }}>
                <div className="card-title">日志证据（这就是判定的依据）</div>
                <div
                  className="mono dim"
                  style={{
                    fontSize: 11.5,
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 130,
                    overflowY: 'auto'
                  }}
                >
                  {diagnosis.evidence.join('\n')}
                </div>
              </div>
            )}

            <div className="card tight" style={{ marginTop: 10, borderColor: 'rgba(201,170,106,.45)' }}>
              <div className="card-title">针对这个问题怎么做</div>
              <ol className="dim" style={{ fontSize: 12.5, lineHeight: 1.95, paddingLeft: 20 }}>
                {diagnosis.steps.map((r, i2) => (
                  <li key={i2}>{r}</li>
                ))}
              </ol>
            </div>
          </>
        )}

        {!diagnosis && info && (
          <>
            <div className="card tight" style={{ marginTop: 12 }}>
              <div className="card-title">可能的原因</div>
              <ul className="dim" style={{ fontSize: 12.5, lineHeight: 1.9, paddingLeft: 18 }}>
                {info.reasons.map((r, i2) => (
                  <li key={i2}>{r}</li>
                ))}
              </ul>
            </div>

            <div className="card tight" style={{ marginTop: 10, borderColor: 'rgba(127,182,155,.45)' }}>
              <div className="card-title">怎么解决（按顺序试）</div>
              <ol className="dim" style={{ fontSize: 12.5, lineHeight: 1.95, paddingLeft: 20 }}>
                {info.steps.map((r, i2) => (
                  <li key={i2}>{r}</li>
                ))}
              </ol>
            </div>
          </>
        )}

        {!diagnosis && !info && (
          <div className="card tight" style={{ marginTop: 12 }}>
            <div className="card-title">怎么排查</div>
            <ol className="dim" style={{ fontSize: 12.5, lineHeight: 1.95, paddingLeft: 20 }}>
              <li>点下方「打开日志目录」，查看 latest.log 的最后 30 行</li>
              <li>日志里出现 OutOfMemoryError → 去版本设置调大内存</li>
              <li>出现 Missing / NoSuchMod → 缺少前置模组，去模组页补全</li>
              <li>出现 nvoglv64 / igd 字样 → 显卡驱动问题，更新驱动</li>
            </ol>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('launch.errorAck')}
          </button>
          <button className="btn" onClick={() => void copyAll()}>
            {copied ? '已复制' : '复制错误信息'}
          </button>
          <button
            className="btn"
            onClick={() => {
              void window.api.project.summary('').catch(() => undefined)
              void window.api.logs.feedback({ extra: `错误码 ${errorCode}\n${message ?? ''}` })
            }}
          >
            打包反馈
          </button>
          <button className="btn primary" onClick={onOpenLogs}>
            <IconFolder />
            {t('launch.openLogFolder')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 启动中：显示实时日志 */
export function LaunchOverlay({
  lines,
  onClose,
  onKill
}: {
  lines: string[]
  onClose: () => void
  onKill?: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [logQuery, setLogQuery] = useState('')
  const [onlyErr, setOnlyErr] = useState(false)
  const tail = useMemo(() => {
    let arr = lines.slice(-400)
    if (onlyErr) arr = arr.filter((l) => /error|exception|caused by|fatal|崩溃/i.test(l))
    if (logQuery.trim()) {
      const q = logQuery.trim().toLowerCase()
      arr = arr.filter((l) => l.toLowerCase().includes(q))
    }
    return arr.slice(-200)
  }, [lines, logQuery, onlyErr])
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 720 }}>
        <h2>{t('launch.running')}</h2>
        <div
          className="mono"
          style={{
            height: 320,
            overflowY: 'auto',
            background: 'rgba(4,8,13,.75)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 12,
            fontSize: 11.5,
            lineHeight: 1.7,
            color: 'var(--txt-dim)',
            whiteSpace: 'pre-wrap'
          }}
        >
          {tail.join('\n')}
        </div>
        <div className="modal-actions">
          {onKill && (
            <button className="btn danger" onClick={onKill}>
              {t('launch.forceStop')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 纯离线登录：不连接任何服务器，填个昵称就能玩。
 * 与「社团账号登录」的区别是它不需要社团授权，适合单机。
 */
export function LocalLogin({ onClose, onDone }: { onClose: () => void; onDone: () => void }): React.ReactElement {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const r = await window.api.account.localLogin(name.trim())
    setBusy(false)
    if (!r.ok) {
      setError(r.message || r.errorCode || 'error')
      return
    }
    onDone()
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h2>{t('accounts.local')}</h2>
        <p style={{ marginBottom: 16 }}>{t('accounts.localHint')}</p>
        <div className="field">
          <label>{t('accounts.offlineName')}</label>
          <input
            className="input"
            value={name}
            placeholder="Steve"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <span className="hint">{t('accounts.nameRule')}</span>
        </div>
        {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? t('common.loading') : t('accounts.localStart')}
          </button>
        </div>
      </div>
    </div>
  )
}
/** 账号列表：在已保存的账号之间切换（切换不会清掉各账号的登录状态） */
export function AccountsDialog({
  accounts,
  activeId,
  onSwitch,
  onRemove,
  onClose
}: {
  accounts: { id: string; name: string; mode: string; uuid: string }[]
  activeId?: string
  onSwitch: (id: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const label = (mode: string): string =>
    mode === 'microsoft' ? t('accounts.microsoft') : mode === 'club' ? t('accounts.club') : t('accounts.local')

  return (
    <div className="overlay">
      <div className="modal">
        <h2>{t('accounts.login')}</h2>
        <p style={{ marginBottom: 14 }}>{t('accounts.switchHint')}</p>
        <div className="vlist" style={{ maxHeight: 320, overflow: 'auto' }}>
          {accounts.map((a) => (
            <div className="vrow" key={a.id} style={{ alignItems: 'center' }}>
              <span className="vid" style={{ minWidth: 140 }}>{a.name}</span>
              <span className="tag">{label(a.mode)}</span>
              <span className="vmeta mono">{a.uuid.slice(0, 8)}</span>
              <span className="vspacer" />
              {a.id === activeId ? (
                <span className="tag ok">{t('accounts.current')}</span>
              ) : (
                <button className="btn sm" onClick={() => onSwitch(a.id)}>
                  {t('accounts.switch')}
                </button>
              )}
              <button className="btn sm ghost" onClick={() => onRemove(a.id)}>
                {t('common.delete')}
              </button>
            </div>
          ))}
          {!accounts.length && <div className="empty">{t('accounts.notLoggedIn')}</div>}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}