import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  useProjectState,
  useDispatch,
  useHistory,
  useProjectPersistence,
  type ProjectStore,
} from '../../store/projectStore'
import { MediaLibrary } from '../media/MediaLibrary'
import { PreviewPanel } from '../preview/PreviewPanel'
import { InspectorPanel, type InspectorTab } from '../inspector/InspectorPanel'
import { TimelinePanel } from '../timeline/TimelinePanel'
import { ToolsPanel } from '../tools/ToolsPanel'
import { TitleBar } from '../titlebar/TitleBar'
import { ProjectSettingsDialog } from '../dialogs/ProjectSettingsDialog'
import { KeyboardShortcutsDialog } from '../dialogs/KeyboardShortcutsDialog'
import { AboutDialog } from '../dialogs/AboutDialog'
import { AutoCaptionsDialog } from '../captions/AutoCaptionsDialog'
import { ApplyCaptionTrackCommand } from '../../core/commands/importAutoCaptionsCommand'
import { exportCaptions } from '../../services/exportCaptions'
import {
  SplitTimelineItemCommand,
  SplitTimelineItemsCommand,
  RemoveTimelineItemCommand,
  RemoveTimelineItemsCommand,
  ImportSubtitlesCommand,
  AddMediaAssetCommand,
  UpdateProjectSettingsCommand,
  RemoveTransitionCommand,
  SelectTransitionCommand,
} from '../../core/commands/editorCommand'
import {
  type UpdateProjectSettingsOptions,
  getLinkedItemIdsForState,
} from '../../core/commands/projectCommands'
import type { RecentProject } from '../../core/persistence/recentProjects'
import { createMediaAssetFromSource } from '../../core/media/mediaExtractor'
import { generateId } from '../../core/utils'
import { usePlayer } from '../preview/usePlayer'
import { openProjectFromFile } from '../../core/persistence/projectLoader'
import { modalCoordinator } from '../../core/modalCoordinator'
import { useModalBlocked } from '../../core/useModalBlocked'
import { UnsavedChangesDialog } from '../common/UnsavedChangesDialog'
import {
  MIN_TIMELINE_HEIGHT,
  AUTO_MAX_TIMELINE_HEIGHT,
  MANUAL_MAX_TIMELINE_HEIGHT,
} from './timelineSizing'
import './EditorShell.css'

interface EditorShellProps {
  onCloseProject?: () => void
  onOpenProject?: (store: ProjectStore) => void
  onNewProject?: () => void
}

/**
 * Main editor layout shell.
 * Coordinates custom TitleBar, MenuBar, workspace panels, persistence, and modal dialogs.
 */
export function EditorShell({ onCloseProject, onOpenProject, onNewProject }: EditorShellProps = {}) {
  const state = useProjectState()
  const dispatch = useDispatch()
  const { undo, redo, canUndo, canRedo } = useHistory()
  const { isDirty, save, saveAs } = useProjectPersistence()
  const isModalBlocked = useModalBlocked()

  // Timeline vertical sizing
  const [manualTimelineHeight, setManualTimelineHeight] = useState<number | null>(null)
  const [isResizingTimeline, setIsResizingTimeline] = useState(false)

  // Media Library horizontal resizing (min 180, max 500, default 240)
  const [mediaLibraryWidth, setMediaLibraryWidth] = useState<number>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('aiditor_media_library_width')
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= 180 && val <= 500) return val
      }
    }
    return 240
  })
  const [isResizingMedia, setIsResizingMedia] = useState(false)
  const [leftPanelTab, setLeftPanelTab] = useState<'media' | 'tools'>('media')
  const [forcedInspectorTab, setForcedInspectorTab] = useState<InspectorTab | null>(null)
  const [zoomLinked, setZoomLinked] = useState(true)
  useEffect(() => {
    if (state.selectedTransitionId) setForcedInspectorTab('transitions')
  }, [state.selectedTransitionId])
  const showEffectsInspector = useCallback(() => {
    dispatch(new SelectTransitionCommand(null))
    setForcedInspectorTab('effects')
  }, [dispatch])

  // Inspector complete collapse state
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState<boolean>(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('aiditor_inspector_collapsed') === 'true'
    }
    return false
  })

  const handleToggleInspectorCollapse = useCallback(() => {
    setIsInspectorCollapsed((prev) => {
      const next = !prev
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('aiditor_inspector_collapsed', next.toString())
      }
      return next
    })
  }, [])

  // Dialog States
  const [isProjectSettingsOpen, setIsProjectSettingsOpen] = useState(false)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [isAutoCaptionsOpen, setIsAutoCaptionsOpen] = useState(false)
  const autoCaptionsClose = useRef<(() => void) | null>(null)
  const closeAutoCaptions = useCallback(() => {
    setIsAutoCaptionsOpen(false)
    autoCaptionsClose.current?.()
    autoCaptionsClose.current = null
  }, [])
  useEffect(() => () => { autoCaptionsClose.current?.() }, [])

  // Native Unsaved Changes Modal State
  const [unsavedDialog, setUnsavedDialog] = useState<{
    isOpen: boolean
    pendingAction: 'close' | 'open' | 'new' | 'exit' | null
    pendingPath?: string
  }>({ isOpen: false, pendingAction: null })

  const { items, selectedItemId, playheadTime, settings } = state
  const fps = settings.fps || 30

  const contentDuration = Object.values(items).reduce(
    (max, item) => Math.max(max, item.startTime + item.duration),
    0
  )

  // Player transport controller
  const player = usePlayer({
    playheadTime,
    contentDuration,
    timelineDuration: Math.max(30, contentDuration),
    fps,
    dispatch,
  })
  const openAutoCaptions = useCallback(() => {
    if (isModalBlocked || isProjectSettingsOpen || isShortcutsOpen || isAboutOpen || unsavedDialog.isOpen) return
    player.stop()
    void modalCoordinator.runExclusive('autoCaptions', () => new Promise<void>(resolve => {
      autoCaptionsClose.current = resolve
      setIsAutoCaptionsOpen(true)
    }))
  }, [isModalBlocked, isProjectSettingsOpen, isShortcutsOpen, isAboutOpen, unsavedDialog.isOpen, player.stop])

  // Timeline height
  const currentTimelineHeight =
    manualTimelineHeight !== null ? manualTimelineHeight : AUTO_MAX_TIMELINE_HEIGHT

  // Subtitle file input ref
  const subtitleInputRef = useRef<HTMLInputElement>(null)
  const handleImportSubtitlesFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (evt) => {
        const content = evt.target?.result as string
        if (content) {
          dispatch(new ImportSubtitlesCommand(content))
        }
      }
      reader.readAsText(file)
      e.target.value = ''
    },
    [dispatch]
  )

  // Media file input ref
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const handleImportMedia = useCallback(async () => {
    if (isModalBlocked) return
    await modalCoordinator.runExclusive('importMedia', async () => {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        try {
          const paths = await (window as any).__TAURI_INTERNALS__.invoke('pick_media_files')
          if (paths && paths.length > 0) {
            for (const path of paths) {
              try {
                const asset = await createMediaAssetFromSource(path)
                dispatch(new AddMediaAssetCommand(asset))
              } catch (err) {
                console.error('Failed to import file:', path, err)
              }
            }
            return
          }
        } catch (err) {
          console.warn('Tauri pick_media_files error, falling back:', err)
        }
      }
      mediaInputRef.current?.click()
    })
  }, [dispatch, isModalBlocked])

  const handleMediaInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return
      for (let i = 0; i < files.length; i++) {
        try {
          const asset = await createMediaAssetFromSource(files[i])
          dispatch(new AddMediaAssetCommand(asset))
        } catch (err) {
          console.error('Failed to import file:', files[i].name, err)
        }
      }
      if (mediaInputRef.current) mediaInputRef.current.value = ''
    },
    [dispatch]
  )

  // Split and Delete Handlers for Edit Menu & Shortcuts
  const initialSelectedIds = state.selectedItemIds && state.selectedItemIds.length > 0
    ? state.selectedItemIds
    : (selectedItemId ? [selectedItemId] : [])

  const canSplit = initialSelectedIds.length > 0
    ? initialSelectedIds.some((id) => {
        const it = items[id]
        return it && playheadTime > it.startTime && playheadTime < it.startTime + it.duration
      })
    : Object.values(items).some((it) => playheadTime > it.startTime && playheadTime < it.startTime + it.duration)
  const canDelete = !!state.selectedTransitionId || initialSelectedIds.length > 0

  const handleSplitAtPlayhead = useCallback(() => {
    let activeIds = state.selectedItemIds && state.selectedItemIds.length > 0
      ? state.selectedItemIds
      : (selectedItemId ? [selectedItemId] : [])

    if (activeIds.length === 0) {
      activeIds = Object.values(items)
        .filter((it) => playheadTime > it.startTime && playheadTime < it.startTime + it.duration)
        .map((it) => it.id)
    }
    if (activeIds.length === 0) return

    const targetIds = new Set<string>()
    for (const id of activeIds) {
      targetIds.add(id)
      for (const lid of getLinkedItemIdsForState(state, id)) {
        targetIds.add(lid)
      }
    }

    const splits: { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }[] = []
    for (const id of targetIds) {
      const item = items[id]
      if (!item) continue
      const itemEnd = item.startTime + item.duration
      if (playheadTime > item.startTime && playheadTime < itemEnd) {
        splits.push({
          itemId: id,
          splitTime: playheadTime,
          leftItemId: generateId('item'),
          rightItemId: generateId('item'),
        })
      }
    }

    if (splits.length === 0) return

    if (splits.length === 1) {
      dispatch(
        new SplitTimelineItemCommand(
          splits[0].itemId,
          splits[0].splitTime,
          splits[0].leftItemId,
          splits[0].rightItemId
        )
      )
    } else {
      dispatch(new SplitTimelineItemsCommand(splits))
    }
  }, [state, selectedItemId, items, playheadTime, dispatch])

  const handleDeleteSelected = useCallback(() => {
    if (state.selectedTransitionId) {
      dispatch(new RemoveTransitionCommand(state.selectedTransitionId))
      return
    }
    const targetIds = new Set<string>()
    const activeIds = state.selectedItemIds && state.selectedItemIds.length > 0
      ? state.selectedItemIds
      : (selectedItemId ? [selectedItemId] : [])

    for (const id of activeIds) {
      targetIds.add(id)
      for (const lid of getLinkedItemIdsForState(state, id)) {
        targetIds.add(lid)
      }
    }

    const idsToDelete = Array.from(targetIds)
    if (idsToDelete.length === 0) return
    if (idsToDelete.length === 1) {
      dispatch(new RemoveTimelineItemCommand(idsToDelete[0]))
    } else {
      dispatch(new RemoveTimelineItemsCommand(idsToDelete))
    }
  }, [state, selectedItemId, dispatch])

  // Project Open / New / Close / Exit flows
  const executeOpenProject = useCallback(
    async (targetPath?: string) => {
      const result = await modalCoordinator.runExclusive('openProject', async () => {
        return await openProjectFromFile(targetPath)
      })
      if (result && onOpenProject) {
        onOpenProject(result.store)
        if (result.missingAssets.length > 0) {
          alert(
            `Project opened with ${result.missingAssets.length} missing media asset(s):\n• ${result.missingAssets.join('\n• ')}`
          )
        }
      }
    },
    [onOpenProject]
  )

  const handleOpen = useCallback(async () => {
    if (isModalBlocked) return
    if (isDirty) {
      setUnsavedDialog({ isOpen: true, pendingAction: 'open' })
      return
    }
    await executeOpenProject()
  }, [isDirty, isModalBlocked, executeOpenProject])

  const handleOpenRecent = useCallback(
    async (recent: RecentProject) => {
      if (isModalBlocked) return
      if (isDirty) {
        setUnsavedDialog({ isOpen: true, pendingAction: 'open', pendingPath: recent.path })
        return
      }
      await executeOpenProject(recent.path)
    },
    [isDirty, isModalBlocked, executeOpenProject]
  )

  const handleNew = useCallback(async () => {
    if (isModalBlocked) return
    if (isDirty) {
      setUnsavedDialog({ isOpen: true, pendingAction: 'new' })
      return
    }
    onNewProject?.()
  }, [isDirty, isModalBlocked, onNewProject])

  const handleClose = useCallback(async () => {
    if (isModalBlocked) return
    if (isDirty) {
      setUnsavedDialog({ isOpen: true, pendingAction: 'close' })
      return
    }
    onCloseProject?.()
  }, [isDirty, isModalBlocked, onCloseProject])

  const handleExit = useCallback(async () => {
    if (isDirty) {
      setUnsavedDialog({ isOpen: true, pendingAction: 'exit' })
      return
    }
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        await getCurrentWindow().close()
      } catch (err) {
        console.warn('Failed to close application window:', err)
      }
    } else {
      onCloseProject?.()
    }
  }, [isDirty, onCloseProject])

  const handleDialogSave = useCallback(async () => {
    const action = unsavedDialog.pendingAction
    const path = unsavedDialog.pendingPath
    setUnsavedDialog({ isOpen: false, pendingAction: null })
    const res = await save()
    if (!res.success) return

    if (action === 'open') {
      await executeOpenProject(path)
    } else if (action === 'close') {
      onCloseProject?.()
    } else if (action === 'new') {
      onNewProject?.()
    } else if (action === 'exit') {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        getCurrentWindow().close()
      } else {
        onCloseProject?.()
      }
    }
  }, [unsavedDialog, save, executeOpenProject, onCloseProject, onNewProject])

  const handleDialogDontSave = useCallback(() => {
    const action = unsavedDialog.pendingAction
    const path = unsavedDialog.pendingPath
    setUnsavedDialog({ isOpen: false, pendingAction: null })
    if (action === 'open') {
      executeOpenProject(path)
    } else if (action === 'close') {
      onCloseProject?.()
    } else if (action === 'new') {
      onNewProject?.()
    } else if (action === 'exit') {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
          getCurrentWindow().close()
        })
      } else {
        onCloseProject?.()
      }
    }
  }, [unsavedDialog, executeOpenProject, onCloseProject, onNewProject])

  const handleDialogCancel = useCallback(() => {
    setUnsavedDialog({ isOpen: false, pendingAction: null })
  }, [])

  const handleResetWorkspace = useCallback(() => {
    setMediaLibraryWidth(240)
    setManualTimelineHeight(null)
    setIsInspectorCollapsed(false)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('aiditor_media_library_width', '240')
      localStorage.setItem('aiditor_inspector_collapsed', 'false')
    }
  }, [])

  const handleSaveProjectSettings = useCallback(
    (opts: UpdateProjectSettingsOptions) => {
      dispatch(new UpdateProjectSettingsCommand(opts))
    },
    [dispatch]
  )

  // ──── Global Keyboard Shortcuts ────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (
        isModalBlocked ||
        unsavedDialog.isOpen ||
        isProjectSettingsOpen ||
        isAutoCaptionsOpen ||
        isShortcutsOpen ||
        isAboutOpen
      ) {
        return
      }

      const activeEl = document.activeElement
      const isInput =
        activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement
      if (isInput) return

      // Fullscreen (F11)
      if (e.key === 'F11') {
        e.preventDefault()
        if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
          import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
            const win = getCurrentWindow()
            win.isFullscreen().then((fs) => win.setFullscreen(!fs))
          })
        }
        return
      }

      // New Project (Ctrl+N)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault()
        handleNew()
        return
      }

      // Save / Save As (Ctrl+S / Ctrl+Shift+S)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) {
          saveAs()
        } else {
          save()
        }
        return
      }

      // Open Project (Ctrl+O)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        handleOpen()
        return
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          if (canRedo) redo()
        } else {
          if (canUndo) undo()
        }
        return
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        if (canRedo) redo()
        return
      }

      // Space = Play / Pause
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        player.togglePlay()
        return
      }

      // Left Arrow = Previous Frame
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        player.stepFrame('prev')
        return
      }

      // Right Arrow = Next Frame
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        player.stepFrame('next')
        return
      }

      // Home = Beginning
      if (e.key === 'Home') {
        e.preventDefault()
        player.seekToStart()
        return
      }

      // End = Timeline End
      if (e.key === 'End') {
        e.preventDefault()
        player.seekToEnd()
        return
      }

      // S = Split at Playhead
      if (e.key === 's' || e.key === 'S') {
        if (canSplit) {
          e.preventDefault()
          handleSplitAtPlayhead()
        }
        return
      }

      // Delete / Backspace = Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (canDelete) {
          e.preventDefault()
          handleDeleteSelected()
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isModalBlocked,
    unsavedDialog.isOpen,
    isProjectSettingsOpen,
    isAutoCaptionsOpen,
    isShortcutsOpen,
    isAboutOpen,
    canUndo,
    canRedo,
    undo,
    redo,
    player,
    save,
    saveAs,
    handleOpen,
    handleNew,
    canSplit,
    canDelete,
    handleSplitAtPlayhead,
    handleDeleteSelected,
  ])

  // ──── Media Library Width Resizing ────
  const handleStartResizeMedia = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || isModalBlocked) return
      e.preventDefault()
      setIsResizingMedia(true)

      const startX = e.clientX
      const startWidth = mediaLibraryWidth

      function handleMouseMove(ev: MouseEvent) {
        const deltaX = ev.clientX - startX
        const nextW = Math.max(180, Math.min(500, Math.round(startWidth + deltaX)))
        setMediaLibraryWidth(nextW)
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('aiditor_media_library_width', nextW.toString())
        }
      }

      function handleMouseUp() {
        setIsResizingMedia(false)
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [mediaLibraryWidth, isModalBlocked]
  )

  const handleStartResizeTimeline = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || isModalBlocked) return
      e.preventDefault()
      setIsResizingTimeline(true)

      const startY = e.clientY
      const startHeight = currentTimelineHeight

      function handleMouseMove(ev: MouseEvent) {
        const deltaY = startY - ev.clientY
        const nextH = Math.max(
          MIN_TIMELINE_HEIGHT,
          Math.min(MANUAL_MAX_TIMELINE_HEIGHT, Math.round(startHeight + deltaY))
        )
        setManualTimelineHeight(nextH)
      }

      function handleMouseUp() {
        setIsResizingTimeline(false)
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [currentTimelineHeight, isModalBlocked]
  )

  const handleResetTimelineHeight = useCallback(() => {
    setManualTimelineHeight(null)
  }, [])

  return (
    <div
      className={`editor-shell no-select ${
        isResizingTimeline || isResizingMedia ? 'is-resizing' : ''
      }`}
    >
      {/* UNIFIED APPLICATION TITLE & MENU BAR */}
      <TitleBar
        projectName={state.name}
        isDirty={isDirty}
        onCloseRequested={handleClose}
        showMenuBar={true}
        canUndo={canUndo}
        canRedo={canRedo}
        canDelete={canDelete}
        canSplit={canSplit}
        onUndo={undo}
        onRedo={redo}
        onDelete={handleDeleteSelected}
        onSplit={handleSplitAtPlayhead}
        onNew={handleNew}
        onSave={save}
        onSaveAs={saveAs}
        onOpen={handleOpen}
        onOpenRecent={handleOpenRecent}
        onClose={handleClose}
        onExit={handleExit}
        onImportMedia={handleImportMedia}
        onImportSubtitles={() => subtitleInputRef.current?.click()}
        onGenerateAutoCaptions={openAutoCaptions}
        canExportCaptions={Object.values(state.items).some(item => item.caption?.text.trim() && state.tracks.some(track => track.id === item.trackId && track.visible !== false))}
        onExportCaptions={() => {
          if (isModalBlocked) return
          player.stop()
          void modalCoordinator.runExclusive('exportCaptions', () => exportCaptions(state)).catch(error => alert(`Could not export captions: ${String(error)}`))
        }}
        onOpenProjectSettings={() => setIsProjectSettingsOpen(true)}
        onToggleInspector={handleToggleInspectorCollapse}
        isInspectorVisible={!isInspectorCollapsed}
        onResetWorkspace={handleResetWorkspace}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onOpenAbout={() => setIsAboutOpen(true)}
      />

      {/* Hidden file inputs for File → Import */}
      <input
        type="file"
        ref={subtitleInputRef}
        style={{ display: 'none' }}
        accept=".srt,.vtt,text/vtt,application/x-subrip"
        onChange={handleImportSubtitlesFile}
      />
      <input
        type="file"
        ref={mediaInputRef}
        multiple
        style={{ display: 'none' }}
        accept="video/*,audio/*,image/*,.mp4,.mov,.mkv,.webm,.mp3,.wav,.aac,.png,.jpg,.jpeg,.webp,.wbmp,.wbpm"
        onChange={handleMediaInputChange}
      />

      {/* 3. EDITOR WORKSPACE */}
      <div className="editor-panels">
        {/* Left Workspace Panel: Media Library & Unified Tools Panel */}
        <div className="panel panel-media left-panel-host" style={{ width: mediaLibraryWidth }}>
          <div className="left-panel-nav">
            <button
              className={`left-panel-tab-btn ${leftPanelTab === 'media' ? 'active' : ''}`}
              onClick={() => setLeftPanelTab('media')}
              title="Project Media Assets"
            >
              <span>📁</span>
              <span>Media</span>
            </button>
            <button
              className={`left-panel-tab-btn ${leftPanelTab === 'tools' ? 'active' : ''}`}
              onClick={() => setLeftPanelTab('tools')}
              title="Creation Tools, Overlays, Layers, Transitions & Effects"
            >
              <span>🛠️</span>
              <span>Tools</span>
            </button>
          </div>
          <div className="left-panel-content">
            {leftPanelTab === 'media' ? (
              <MediaLibrary state={state} dispatch={dispatch} />
            ) : (
              <ToolsPanel
                state={state}
                dispatch={dispatch}
                onEffectApplied={showEffectsInspector}
              />
            )}
          </div>
        </div>

        <div
          className={`panel-resizer ${isResizingMedia ? 'resizing' : ''}`}
          onMouseDown={handleStartResizeMedia}
          title="Drag to resize Media Library width"
        />

        {/* Center: Preview Panel */}
        <div className="panel panel-preview">
          {!isAutoCaptionsOpen && <PreviewPanel state={state} dispatch={dispatch} player={player} zoomLinked={zoomLinked} />}
        </div>

        {/* Right: Contextual Inspector Panel */}
        {!isInspectorCollapsed ? (
          <div className="panel panel-inspector">
            <InspectorPanel
              state={state}
              dispatch={dispatch}
              onToggleCollapse={handleToggleInspectorCollapse}
              forcedTab={forcedInspectorTab}
              onTabChange={setForcedInspectorTab}
              zoomLinked={zoomLinked}
              onZoomLinkedChange={setZoomLinked}
            />
          </div>
        ) : (
          <div
            className="inspector-collapsed-tab"
            onClick={handleToggleInspectorCollapse}
            title="Expand Inspector"
            role="button"
            aria-label="Expand Inspector"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleToggleInspectorCollapse()
              }
            }}
          >
            <span className="inspector-collapsed-chevron">‹</span>
            <span className="inspector-collapsed-label">Inspector</span>
          </div>
        )}
      </div>

      {/* 4. TIMELINE */}
      <div
        className={`timeline-resizer ${isResizingTimeline ? 'resizing' : ''}`}
        onMouseDown={handleStartResizeTimeline}
        onDoubleClick={handleResetTimelineHeight}
        title="Drag to resize timeline height (2 – 7 layers) • Double-click to auto-fit"
      >
        <div className="timeline-resizer-handle" />
      </div>

      <div className="editor-timeline" style={{ height: currentTimelineHeight }}>
        <TimelinePanel
          state={state}
          dispatch={dispatch}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onEffectApplied={showEffectsInspector}
        />
      </div>

      {/* ── Dialog Modals ── */}
      <UnsavedChangesDialog
        isOpen={unsavedDialog.isOpen}
        projectName={state.name}
        onSave={handleDialogSave}
        onDontSave={handleDialogDontSave}
        onCancel={handleDialogCancel}
      />

      <ProjectSettingsDialog
        isOpen={isProjectSettingsOpen}
        state={state}
        onSave={handleSaveProjectSettings}
        onClose={() => setIsProjectSettingsOpen(false)}
      />

      {isAutoCaptionsOpen && <AutoCaptionsDialog state={state} dispatch={dispatch} player={player} onClose={closeAutoCaptions} onImport={transcript => {
        dispatch(new ApplyCaptionTrackCommand(transcript))
        closeAutoCaptions()
      }} />}

      <KeyboardShortcutsDialog
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      <AboutDialog
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
      />
    </div>
  )
}
