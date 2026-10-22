import React, { useState } from 'react'
import { useI18n } from '@/i18n'
import { TERMS_SECTIONS, TERMS_VERSION } from '@shared/terms'

/**
 * 用户协议与免责声明。
 * requireAgree = true 时，必须勾选「我已阅读并同意」才能点「同意并继续」。
 */
export function TermsDialog({
  requireAgree = false,
  onAgree,
  onCancel
}: {
  requireAgree?: boolean
  onAgree?: () => void
  onCancel: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [checked, setChecked] = useState(!requireAgree)

  return (
    <div className="overlay" style={{ zIndex: 200 }}>
      <div className="modal" style={{ width: 720, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            {t('terms.title')}
            <span className="tag" style={{ marginLeft: 8 }}>
              {TERMS_VERSION}
            </span>
          </h2>
          <button className="win-btn" style={{ height: 26, width: 26 }} onClick={onCancel}>
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 6 }}>
          {TERMS_SECTIONS.map((s) => (
            <div key={s.title} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 620, color: 'var(--accent)', marginBottom: 5 }}>{s.title}</div>
              {s.lines.map((line, i) => (
                <div
                  key={i}
                  style={{ fontSize: 12.5, color: 'var(--txt-dim)', lineHeight: 1.85, paddingLeft: 2 }}
                >
                  · {line}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: '#7fb69b' }}
            />
            {t('terms.agreeCheckbox')}
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={onCancel}>
              {requireAgree ? t('terms.disagree') : t('common.close')}
            </button>
            {requireAgree && (
              <button className="btn primary" disabled={!checked} onClick={onAgree}>
                {t('terms.agree')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
