import React, { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
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
        <h2>{t('accounts.offline')}</h2>
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
          <span className="hint">{t('accounts.nameRule')}</span>
        </div>
        {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={busy || !name.trim()}
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
  onClose,
  onOpenLogs
}: {
  errorCode: string
  message?: string
  onClose: () => void
  onOpenLogs: () => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-icon" style={{ background: 'rgba(255,107,129,.12)', color: 'var(--err)' }}>
          <IconWarn />
        </div>
        <h2>
          {t('launch.errorTitle')}（{errorCode}）
        </h2>
        {message && <p className="dim" style={{ marginTop: 8, fontSize: 12.5 }}>{message}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('launch.errorAck')}
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
  const tail = useMemo(() => lines.slice(-200), [lines])
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
