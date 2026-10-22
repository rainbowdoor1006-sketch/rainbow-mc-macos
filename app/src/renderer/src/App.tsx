import React, { useCallback, useEffect, useRef, useState } from 'react'
import { I18nProvider, localeForRegion, useI18n } from '@/i18n'
import type { AppSettings, AppState, LocaleCode, RegionCode } from '@shared/types'
import { MainlandNotice, RegionPicker } from '@/components/RegionGate'
import { LaunchError, LaunchOverlay, LoginOffline, MsLogin } from '@/components/Dialogs'
import { InstancePanel } from '@/components/InstancePanel'
import { ProjectList } from '@/components/ProjectList'
import { LoginGate } from '@/components/LoginGate'
import { TermsDialog } from '@/components/TermsDialog'
import { AppearanceLayer } from '@/components/AppearanceLayer'
import { DownloadOrb } from '@/components/DownloadOrb'
import { DropImport } from '@/components/DropImport'
import { LibraryPage } from '@/pages/LibraryPage'
import { UpdateDialog, type LatestInfoView, type UpdateMode } from '@/components/UpdateDialog'
import { TopBar } from '@/components/TopBar'
import { SidePanel } from '@/components/SidePanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Launch } from '@/pages/Launch'
import { Download } from '@/pages/Download'
import { Settings } from '@/pages/Settings'
import { More } from '@/pages/More'

export type Page = 'launch' | 'download' | 'library' | 'settings' | 'more'
type Dialog = 'none' | 'project' | 'login-offline' | 'login-ms' | 'instance' | 'terms'

export default function App(): React.ReactElement {
  const [state, setState] = useState<AppState | null>(null)
  const [page, setPage] = useState<Page>('launch')
  const [gate, setGate] = useState<'none' | 'picker' | 'notice'>('none')
  const [dialog, setDialog] = useState<Dialog>('none')
  const [launchingProjectId, setLaunchingProjectId] = useState<string | null>(null)
  const [running, setRunning] = useState<{ runId: string; projectId: string } | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const [error, setError] = useState<{ code: string; message?: string } | null>(null)
  const [updateMode, setUpdateMode] = useState<UpdateMode | null>(null)
  const [updateLatest, setUpdateLatest] = useState<LatestInfoView | null>(null)
  const [updateLocal, setUpdateLocal] = useState('')
  const [updateProgress, setUpdateProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [updateError, setUpdateError] = useState('')
  const [currentVersion, setCurrentVersion] = useState('—')
  const linesRef = useRef<string[]>([])

  // ESC 关闭当前弹出层（错误弹窗 / 更新弹窗 / 各种对话框 / 日志浮层）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (error) {
        setError(null)
        return
      }
      if (updateMode) {
        setUpdateMode(null)
        return
      }
      if (dialog !== 'none') {
        setDialog('none')
        return
      }
      if (showLog) setShowLog(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [error, updateMode, dialog, showLog])

  const refresh = useCallback(() => {
    window.api.getState().then(setState)
  }, [])

  useEffect(() => {
    window.api.getState().then((s) => {
      setState(s)
      if (!s.settings.regionChosen) {
        const needNotice = s.settings.region === 'CN' && !s.settings.regionNoticeAccepted
        setGate(needNotice ? 'notice' : 'picker')
      }
    })
    if (window.api.uiFlags?.testErrorDialog) {
      setError({ code: 'E2001', message: '游戏进程异常退出（测试弹窗）' })
    }
    void window.api.getVersion().then(setCurrentVersion)
    void window.api.getState().then(async (s) => {
      if (!s.settings.autoCheckUpdate) return
      const r = await window.api.update.check()
      if (!r.ok || !r.latest) return
      if (r.state === 'older') {
        // 用户点过「不用了，谢谢」的同一个版本，不再打扰
        if (s.settings.skippedVersion === r.latest.version) return
        // 显示「实际参与比较的本地版本」，否则会出现 0.2.1 → 0.2.1 这种错觉
        setUpdateLocal(r.local.version)
        setUpdateLatest(r.latest)
        setUpdateMode('newer')
      } else if (r.state === 'newer') {
        setUpdateLocal(r.local.version)
        setUpdateLatest(r.latest)
        setUpdateMode('preview')
      }
    })
    const offLine = window.api.mc.onLaunchLine(({ line }) => {
      linesRef.current = [...linesRef.current, line]
      setLines(linesRef.current)
    })
    const offDone = window.api.mc.onLaunchDone((r) => {
      setLaunchingProjectId(null)
      if (!r.ok && !r.killed) setError({ code: r.errorCode || 'E0000', message: r.message })
      refresh()
    })
    const offRunning = window.api.mc.onRunning((p) => {
      setRunning(p.running ? { runId: p.runId, projectId: p.projectId } : null)
    })
    void window.api.mc.running().then((list) => {
      if (list.length) setRunning(list[0])
    })
    return () => {
      offLine()
      offDone()
      offRunning()
    }
  }, [refresh])

  const applySettings = useCallback(async (patch: Partial<AppSettings>) => {
    const s = await window.api.updateSettings(patch)
    setState(s)
  }, [])

  const setLocale = useCallback(
    (l: LocaleCode) => {
      void applySettings({ locale: l })
    },
    [applySettings]
  )

  const pickRegion = useCallback(async (r: RegionCode) => {
    const s = await window.api.updateSettings({
      region: r,
      locale: localeForRegion(r),
      regionChosen: r !== 'CN',
      regionNoticeAccepted: r !== 'CN'
    })
    setState(s)
    setGate(r === 'CN' ? 'notice' : 'none')
  }, [])

  const ackNotice = useCallback(async () => {
    const s = await window.api.updateSettings({ regionChosen: true, regionNoticeAccepted: true })
    setState(s)
    setGate('none')
  }, [])

  const cancelNotice = useCallback(async () => {
    const s = await window.api.updateSettings({ regionChosen: false, regionNoticeAccepted: false })
    setState(s)
    setGate('picker')
  }, [])

  const doLaunch = useCallback(async () => {
    if (!state) return
    const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0]
    if (!project) return
    linesRef.current = []
    setLines([])
    setLaunchingProjectId(project.id)
    setError(null)
    setShowLog(true)
    await window.api.mc.launch(project.id)
  }, [state])

  const doKill = useCallback(async () => {
    // 不传 runId：准备阶段也能取消，运行中则杀进程树
    await window.api.mc.kill(running?.runId)
  }, [running])

  if (!state) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="dim">...</div>
      </div>
    )
  }

  return (
    <I18nProvider locale={state.settings.locale} setLocale={setLocale}>
      <AppearanceLayer appearance={state.settings.appearance} />
      <DownloadOrb />
      <DropImport onImported={() => void refresh()} />
      {!(() => {
        const active = state.accounts.find((a) => a.id === state.activeAccountId)
        if (!active) return false
        if (active.mode === 'microsoft') return !!active.accessToken
        // 社团网站授权登录
        return !!active.clubToken
      })() && (
        <LoginGate
          onClubLogin={() => setDialog('login-offline')}
          onMsLogin={() => setDialog('login-ms')}
          onTerms={() => setDialog('terms')}
        />
      )}
      <AppShell
        state={state}
        page={page}
        setPage={setPage}
        launchingProjectId={launchingProjectId}
        runningProjectId={running?.projectId ?? null}
        onKill={() => void doKill()}
        onPickRegion={pickRegion}
        applySettings={applySettings}
        onLaunch={() => void doLaunch()}
        onPickProject={() => setDialog('project')}
        onOpenInstance={() => setDialog('instance')}
        onLogin={(m) => setDialog(m === 'offline' ? 'login-offline' : 'login-ms')}
        onRefresh={refresh}
      />

      {dialog === 'project' && (
        <ProjectList
          state={state}
          onClose={() => setDialog('none')}
          onChanged={refresh}
          onOpenInstance={(id) => {
            void window.api.project.setActive(id).then(() => {
              refresh()
              setDialog('instance')
            })
          }}
        />
      )}
      {dialog === 'terms' && (
        <TermsDialog
          onCancel={() => setDialog('none')}
        />
      )}

      {dialog === 'login-offline' && (
        <LoginOffline
          mockMode={state.settings.clubApi.mockMode}
          onClose={() => setDialog('none')}
          onDone={() => {
            setDialog('none')
            refresh()
          }}
        />
      )}
      {dialog === 'login-ms' && (
        <MsLogin
          hasClientId={!!state.settings.microsoftClientId}
          onClose={() => setDialog('none')}
          onDone={() => {
            setDialog('none')
            refresh()
          }}
          onGoSettings={() => {
            setDialog('none')
            setPage('settings')
          }}
        />
      )}

      {dialog === 'instance' && state && state.projects.length > 0 && (
        <InstancePanel
          state={state}
          project={state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0]}
          onClose={() => setDialog('none')}
          onChanged={refresh}
          onGoDownload={() => {
            setDialog('none')
            setPage('download')
          }}
          onGoSettings={() => {
            setDialog('none')
            setPage('settings')
          }}
          onDeleted={() => setDialog('none')}
        />
      )}

      {showLog && !!launchingProjectId && (
        <LaunchOverlay
          lines={lines}
          onClose={() => setShowLog(false)}
          onKill={() => {
            void window.api.mc.kill()
          }}
        />
      )}

      {error && (
        <LaunchError
          errorCode={error.code}
          message={error.message}
          onClose={() => setError(null)}
          onOpenLogs={() => {
            void window.api.openLogs()
          }}
        />
      )}

      {updateMode && (
        <UpdateDialog
          mode={updateMode}
          localVersion={updateLocal || currentVersion}
          latest={updateLatest ?? undefined}
          progress={updateProgress}
          error={updateError}
          onUpdate={() => {
            if (!updateLatest) return
            void (async () => {
              setUpdateError('')
              setUpdateProgress({ loaded: 0, total: updateLatest.size })
              const off = window.api.update.onProgress((p) => setUpdateProgress(p))
              const r = await window.api.update.download(updateLatest)
              off()
              setUpdateProgress(null)
              if (!r.ok || !r.path) {
                setUpdateError(r.message || '下载失败')
                return
              }
              const applied = await window.api.update.apply(r.path)
              if (!applied.ok) setUpdateError(applied.message || '安装失败')
            })()
          }}
          onSkip={() => {
            if (updateLatest) void window.api.update.skip(updateLatest.version)
            setUpdateMode(null)
          }}
          onContinue={() => setUpdateMode(null)}
          onQuit={() => void window.api.win.close()}
        />
      )}

      {gate === 'picker' && <RegionPicker onPick={pickRegion} />}
      {gate === 'notice' && <MainlandNotice onAck={ackNotice} onCancel={cancelNotice} />}
    </I18nProvider>
  )
}

function AppShell({
  state,
  page,
  setPage,
  launchingProjectId,
  runningProjectId,
  onKill,
  onPickRegion,
  applySettings,
  onLaunch,
  onPickProject,
  onOpenInstance,
  onLogin,
  onRefresh
}: {
  state: AppState
  page: Page
  setPage: (p: Page) => void
  launchingProjectId: string | null
  runningProjectId: string | null
  onKill: () => void
  onPickRegion: (r: RegionCode) => void
  applySettings: (patch: Partial<AppSettings>) => Promise<void>
  onLaunch: () => void
  onPickProject: () => void
  onOpenInstance: () => void
  onLogin: (m: 'offline' | 'microsoft') => void
  onRefresh: () => void
}): React.ReactElement {
  const { t } = useI18n()

  return (
    <div className="app">
      <TopBar page={page} setPage={setPage} />
      <div className="body">
        <SidePanel
          state={state}
          launchingProjectId={launchingProjectId}
          runningProjectId={runningProjectId}
          onKill={onKill}
          onGoDownload={() => setPage('download')}
          onLaunch={onLaunch}
          onPickProject={onPickProject}
          onOpenInstance={onOpenInstance}
          onLogin={onLogin}
          onRefresh={onRefresh}
        />
        <div className="content">
          <div className="content-watermark">{t('app.name')}</div>
          <div className="content-scroll">
            <ErrorBoundary resetKey={page} onReset={() => setPage('launch')}>
              {page === 'launch' && (
                <Launch
                  state={state}
                  launchingProjectId={launchingProjectId}
                  runningProjectId={runningProjectId}
                  onLaunch={onLaunch}
                  onKill={onKill}
                />
              )}
              {page === 'download' && <Download state={state} />}
              {page === 'library' && <LibraryPage />}
              {page === 'settings' && (
                <Settings settings={state.settings} onChange={applySettings} onPickRegion={onPickRegion} onRefresh={onRefresh} />
              )}
              {page === 'more' && <More state={state} applySettings={applySettings} />}
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  )
}
