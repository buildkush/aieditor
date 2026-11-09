import React from 'react'

interface AboutDialogProps {
  isOpen: boolean
  onClose: () => void
}

export const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null

  return (
    <div className="aiditor-modal-backdrop" onClick={onClose}>
      <div
        className="aiditor-modal-card"
        style={{ width: 380, maxWidth: '90vw', textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="aiditor-modal-header">
          <div className="aiditor-modal-title">
            <span>About aiditor</span>
          </div>
          <button className="aiditor-modal-close" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(85, 128, 240, 0.25), rgba(85, 128, 240, 0.05))',
              border: '1px solid var(--accent, #5580f0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent, #5580f0)',
            }}
          >
            <svg viewBox="0 0 32 32" fill="none" width="28" height="28">
              <rect x="2" y="6" width="28" height="20" rx="4" stroke="currentColor" strokeWidth="2.4" />
              <polygon points="13,11 22,16 13,21" fill="currentColor" />
            </svg>
          </div>

          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #e8e9ed)' }}>
              aiditor
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-accent, #7c9dff)', marginTop: 2 }}>
              Version 0.1.0
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-secondary, #9a9ba3)', lineHeight: 1.5, margin: 0 }}>
            Local-first, creator-focused desktop video editor built for modern content creators and AI agents.
          </p>

          <div
            style={{
              fontSize: 11,
              color: 'var(--text-tertiary, #6b6c75)',
              borderTop: '1px solid var(--border-subtle, #1e1f26)',
              paddingTop: 12,
              width: '100%',
            }}
          >
            Open Source • Desktop First • Single Source of Truth
          </div>
        </div>

        <div className="aiditor-modal-footer" style={{ padding: '10px 18px', justifyContent: 'center' }}>
          <button type="button" className="modal-btn primary" onClick={onClose} style={{ minWidth: 100 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
