import React, { useState, useEffect, useCallback } from 'react'
import { MenuBar, type MenuBarProps } from '../editor/MenuBar'
import './TitleBar.css'

export interface TitleBarProps extends Partial<MenuBarProps> {
  projectName?: string
  isDirty?: boolean
  onCloseRequested?: () => void
  showMenuBar?: boolean
}

async function invokeTauri<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
    try {
      return await (window as any).__TAURI_INTERNALS__.invoke(cmd, args)
    } catch (err) {
      console.warn(`invoke ${cmd} error:`, err)
      return null
    }
  }
  return null
}

/**
 * Unified Custom Title Bar and Menu Bar for aiditor.
 * Places [Logo] aiditor [File Edit View Help] on the left,
 * Project Name in center, and Minimize / Maximize / Close on the right.
 */
export const TitleBar: React.FC<TitleBarProps> = ({
  projectName,
  isDirty = false,
  onCloseRequested,
  showMenuBar = false,
  canUndo = false,
  canRedo = false,
  canDelete = false,
  canSplit = false,
  onUndo = () => {},
  onRedo = () => {},
  onDelete,
  onSplit,
  onNew,
  onSave,
  onSaveAs,
  onOpen,
  onOpenRecent,
  onClose,
  onExit,
  onImportMedia,
  onImportSubtitles,
  onGenerateAutoCaptions,
  onExportCaptions,
  canExportCaptions,
  onOpenProjectSettings,
  onToggleInspector,
  isInspectorVisible,
  onResetWorkspace,
  onOpenShortcuts,
  onOpenAbout,
}) => {
  const [isMaximized, setIsMaximized] = useState(false)

  // Track window state with Tauri API + custom command fallback
  useEffect(() => {
    let unlisten: (() => void) | undefined

    const checkMaximized = async () => {
      // Try custom command first
      const customRes = await invokeTauri<boolean>('app_is_maximized')
      if (typeof customRes === 'boolean') {
        setIsMaximized(customRes)
        return
      }

      // Try official API
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          const win = getCurrentWindow()
          const max = await win.isMaximized()
          setIsMaximized(max)
        } catch {
          // ignore
        }
      }
    }

    checkMaximized()

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => {
          const win = getCurrentWindow()
          win
            .onResized(() => {
              checkMaximized()
            })
            .then((fn) => {
              unlisten = fn
            })
            .catch(() => {})
        })
        .catch(() => {})
    }

    return () => {
      unlisten?.()
    }
  }, [])

  // Window drag fallback handler
  const handleStartDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => {
          getCurrentWindow().startDragging().catch(() => {})
        })
        .catch(() => {})
    }
  }, [])

  const handleMinimize = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    // Try custom command first
    const ok = await invokeTauri('app_minimize_window')
    if (ok !== null) return

    // Fallback to official API
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        await getCurrentWindow().minimize()
      } catch (err) {
        console.warn('Failed to minimize window:', err)
      }
    }
  }, [])

  const handleToggleMaximize = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    // Try custom command first
    const res = await invokeTauri<boolean>('app_toggle_maximize_window')
    if (typeof res === 'boolean') {
      setIsMaximized(res)
      return
    }

    // Fallback to official API
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        await getCurrentWindow().toggleMaximize()
        const next = await getCurrentWindow().isMaximized()
        setIsMaximized(next)
      } catch (err) {
        console.warn('Failed to toggle maximize:', err)
      }
    } else {
      setIsMaximized((prev) => !prev)
    }
  }, [])

  const handleClose = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (onCloseRequested) {
        onCloseRequested()
        return
      }

      // Try custom command first
      const ok = await invokeTauri('app_close_window')
      if (ok !== null) return

      // Fallback to official API
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          await getCurrentWindow().close()
        } catch (err) {
          console.warn('Failed to close window:', err)
        }
      }
    },
    [onCloseRequested]
  )

  return (
    <div
      className="aiditor-titlebar no-select"
      data-tauri-drag-region
      onMouseDown={handleStartDrag}
      onDoubleClick={handleToggleMaximize}
    >
      {/* LEFT: Logo & App Title & Integrated MenuBar */}
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="titlebar-app-icon" data-tauri-drag-region>
          <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" width="15" height="15">
            <rect x="2" y="6" width="28" height="20" rx="4" stroke="currentColor" strokeWidth="2.4" />
            <polygon points="13,11 22,16 13,21" fill="currentColor" />
          </svg>
        </span>
        <span className="titlebar-app-name" data-tauri-drag-region>aiditor</span>

        {/* Integrated Menus: File, Edit, View, Help right on top bar */}
        {showMenuBar && (
          <div
            className="titlebar-integrated-menu"
            data-tauri-drag-region="false"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <MenuBar
              projectName={projectName}
              isDirty={isDirty}
              canUndo={canUndo}
              canRedo={canRedo}
              canDelete={canDelete}
              canSplit={canSplit}
              onUndo={onUndo}
              onRedo={onRedo}
              onDelete={onDelete}
              onSplit={onSplit}
              onNew={onNew}
              onSave={onSave}
              onSaveAs={onSaveAs}
              onOpen={onOpen}
              onOpenRecent={onOpenRecent}
              onClose={onClose}
              onExit={onExit}
              onImportMedia={onImportMedia}
              onImportSubtitles={onImportSubtitles}
              onExportCaptions={onExportCaptions}
              canExportCaptions={canExportCaptions}
              onGenerateAutoCaptions={onGenerateAutoCaptions}
              onOpenProjectSettings={onOpenProjectSettings}
              onToggleInspector={onToggleInspector}
              isInspectorVisible={isInspectorVisible}
              onResetWorkspace={onResetWorkspace}
              onOpenShortcuts={onOpenShortcuts}
              onOpenAbout={onOpenAbout}
            />
          </div>
        )}
      </div>

      {/* CENTER: Draggable region with optional Project Name */}
      <div className="titlebar-center" data-tauri-drag-region>
        {projectName && (
          <div className="titlebar-project-info" data-tauri-drag-region>
            <span className="titlebar-project-name" data-tauri-drag-region>{projectName}</span>
            {isDirty && (
              <span className="titlebar-dirty-dot" title="Unsaved changes" data-tauri-drag-region>
                ●
              </span>
            )}
          </div>
        )}
      </div>

      {/* RIGHT: Window Controls (Minimize, Maximize / Restore, Close) */}
      <div
        className="titlebar-window-controls"
        data-tauri-drag-region="false"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className="titlebar-window-btn btn-minimize"
          onClick={handleMinimize}
          title="Minimize"
          aria-label="Minimize Window"
          tabIndex={-1}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" fill="currentColor">
            <rect y="4.5" width="10" height="1" />
          </svg>
        </button>

        <button
          className="titlebar-window-btn btn-maximize"
          onClick={handleToggleMaximize}
          title={isMaximized ? 'Restore Down' : 'Maximize'}
          aria-label={isMaximized ? 'Restore Down' : 'Maximize Window'}
          tabIndex={-1}
        >
          {isMaximized ? (
            // Restore icon (overlapping squares)
            <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2.5" y="0.5" width="7" height="7" rx="0.5" />
              <rect x="0.5" y="2.5" width="7" height="7" rx="0.5" fill="var(--bg-app, #0d0e12)" />
            </svg>
          ) : (
            // Maximize icon (single square)
            <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
            </svg>
          )}
        </button>

        <button
          className="titlebar-window-btn btn-close"
          onClick={handleClose}
          title="Close"
          aria-label="Close Window"
          tabIndex={-1}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M1 1l8 8M9 1L1 9" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
