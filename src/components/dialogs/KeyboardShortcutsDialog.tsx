import React from 'react'

interface KeyboardShortcutsDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface ShortcutItem {
  keys: string
  desc: string
}

const SHORTCUT_GROUPS: { group: string; shortcuts: ShortcutItem[] }[] = [
  {
    group: 'General',
    shortcuts: [
      { keys: 'Ctrl + N', desc: 'New Project' },
      { keys: 'Ctrl + O', desc: 'Open Project' },
      { keys: 'Ctrl + S', desc: 'Save Project' },
      { keys: 'Ctrl + Shift + S', desc: 'Save As' },
      { keys: 'F11', desc: 'Toggle Fullscreen' },
    ],
  },
  {
    group: 'Editing & Timeline',
    shortcuts: [
      { keys: 'V', desc: 'Selection Tool (default pointer)' },
      { keys: 'C', desc: 'Split / Razor Tool (cut clips)' },
      { keys: 'Ctrl + Z', desc: 'Undo' },
      { keys: 'Ctrl + Y / Ctrl+Shift+Z', desc: 'Redo' },
      { keys: 'S', desc: 'Split clip at playhead' },
      { keys: 'Delete / Backspace', desc: 'Delete selected clip' },
      { keys: 'N', desc: 'Toggle timeline snapping' },
    ],
  },
  {
    group: 'Playback & Navigation',
    shortcuts: [
      { keys: 'Space', desc: 'Play / Pause' },
      { keys: '← / →', desc: 'Step 1 frame backward / forward' },
      { keys: 'Home / End', desc: 'Seek to start / end of timeline' },
    ],
  },
]

export const KeyboardShortcutsDialog: React.FC<KeyboardShortcutsDialogProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null

  return (
    <div className="aiditor-modal-backdrop" onClick={onClose}>
      <div
        className="aiditor-modal-card"
        style={{ width: 440, maxWidth: '90vw' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="aiditor-modal-header">
          <div className="aiditor-modal-title">
            <span className="modal-title-icon">⌨️</span>
            <span>Keyboard Shortcuts</span>
          </div>
          <button className="aiditor-modal-close" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {SHORTCUT_GROUPS.map((grp) => (
            <div key={grp.group} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-accent, #7c9dff)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {grp.group}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border, #2a2b35)',
                  borderRadius: 6,
                  padding: '6px 10px',
                }}
              >
                {grp.shortcuts.map((s) => (
                  <div
                    key={s.keys}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      padding: '3px 0',
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary, #9a9ba3)' }}>{s.desc}</span>
                    <kbd
                      style={{
                        padding: '2px 6px',
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: 4,
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary, #e8e9ed)',
                      }}
                    >
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="aiditor-modal-footer" style={{ padding: '10px 18px' }}>
          <button type="button" className="modal-btn primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
