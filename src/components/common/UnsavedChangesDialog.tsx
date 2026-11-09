import { useEffect, useRef } from 'react'
import './UnsavedChangesDialog.css'

export type UnsavedChangesAction = 'save' | 'dont_save' | 'cancel'

interface UnsavedChangesDialogProps {
  isOpen: boolean
  projectName: string
  onSave: () => void
  onDontSave: () => void
  onCancel: () => void
}

/**
 * Aiditor-native unsaved changes modal dialog.
 * Replaces generic browser beforeunload confirmation with a polished,
 * keyboard-accessible (Escape/Enter) dialog matching aiditor design system.
 */
export function UnsavedChangesDialog({
  isOpen,
  projectName,
  onSave,
  onDontSave,
  onCancel,
}: UnsavedChangesDialogProps) {
  const saveBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isOpen) {
      // Focus the primary Save button on open
      setTimeout(() => {
        saveBtnRef.current?.focus()
      }, 50)

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }

      window.addEventListener('keydown', handleKeyDown, { capture: true })
      return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [isOpen, onCancel])

  if (!isOpen) return null

  return (
    <div className="aiditor-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="aiditor-modal-card">
        <div className="aiditor-modal-header">
          <span className="aiditor-modal-icon">⚠️</span>
          <h2 id="modal-title" className="aiditor-modal-title">Unsaved Changes</h2>
        </div>
        <p className="aiditor-modal-message">
          Project <strong>&ldquo;{projectName}&rdquo;</strong> has unsaved changes.
          Do you want to save before leaving?
        </p>
        <div className="aiditor-modal-actions">
          <button
            type="button"
            className="aiditor-btn aiditor-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="aiditor-btn aiditor-btn-danger"
            onClick={onDontSave}
          >
            Don&apos;t Save
          </button>
          <button
            ref={saveBtnRef}
            type="button"
            className="aiditor-btn aiditor-btn-primary"
            onClick={onSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
