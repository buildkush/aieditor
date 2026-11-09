import { useRef, useCallback, useState } from 'react'
import type { ProjectState } from '../../core/project/projectState'
import type { EditorCommand } from '../../core/commands/editorCommand'
import { AddMediaAssetCommand } from '../../core/commands/editorCommand'
import { createMediaAssetFromSource } from '../../core/media/mediaExtractor'
import { setActiveDraggedAsset } from './activeDragAsset'
import { modalCoordinator } from '../../core/modalCoordinator'
import { useModalBlocked } from '../../core/useModalBlocked'
import './MediaLibrary.css'

interface MediaLibraryProps {
  state: ProjectState
  dispatch: (command: EditorCommand) => void
}

async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
    try {
      return await (window as any).__TAURI_INTERNALS__.invoke(cmd, args)
    } catch {
      return null
    }
  }
  return null
}

/**
 * Media Library panel.
 * Displays imported real media assets in Grid or List mode,
 * supports native modal single-flight picker and drag onto timeline.
 */
export function MediaLibrary({ state, dispatch }: MediaLibraryProps) {
  const assets = Object.values(state.assets)
  const [isImporting, setIsImporting] = useState(false)
  const isModalBlocked = useModalBlocked()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // View mode preference stored in localStorage (UI-only preference)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    if (typeof localStorage !== 'undefined') {
      return (localStorage.getItem('aiditor_media_view_mode') as 'grid' | 'list') || 'grid'
    }
    return 'grid'
  })

  const handleToggleViewMode = (mode: 'grid' | 'list') => {
    setViewMode(mode)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('aiditor_media_view_mode', mode)
    }
  }

  const mediaTypeIcon = (type: string) => {
    switch (type) {
      case 'video':
        return '🎬'
      case 'audio':
        return '🎵'
      case 'image':
        return '🖼️'
      case 'caption':
        return '💬'
      default:
        return '📄'
    }
  }

  const handleImportClick = useCallback(async () => {
    if (isModalBlocked || isImporting) return

    await modalCoordinator.runExclusive('importMedia', async () => {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const paths = await tauriInvoke<string[]>('pick_media_files')
        if (paths && paths.length > 0) {
          setIsImporting(true)
          for (const path of paths) {
            try {
              const asset = await createMediaAssetFromSource(path)
              dispatch(new AddMediaAssetCommand(asset))
            } catch (err) {
              console.error('Failed to import file:', path, err)
            }
          }
          setIsImporting(false)
          return
        }
      } else {
        fileInputRef.current?.click()
      }
    })
  }, [dispatch, isModalBlocked, isImporting])



  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setIsImporting(true)
    for (let i = 0; i < files.length; i++) {
      try {
        const asset = await createMediaAssetFromSource(files[i])
        dispatch(new AddMediaAssetCommand(asset))
      } catch (err) {
        console.error('Failed to import file:', files[i].name, err)
      }
    }
    setIsImporting(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Handle dragging external media files into Media Library
  const handlePanelDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handlePanelDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return

    setIsImporting(true)
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      try {
        const file = e.dataTransfer.files[i]
        const asset = await createMediaAssetFromSource(file)
        dispatch(new AddMediaAssetCommand(asset))
      } catch (err) {
        console.error('Failed to import dropped file:', err)
      }
    }
    setIsImporting(false)
  }

  return (
    <>
      <div className="panel-header">
        <div className="panel-header-left">
          <span className="panel-header-title">Media</span>
          <span className="media-count">{assets.length}</span>
        </div>
        <div className="media-header-actions">
          <div className="view-mode-toggle" role="group" aria-label="Media View Mode">
            <button
              className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => handleToggleViewMode('grid')}
              title="Grid View"
              aria-label="Grid View"
            >
              ⊞
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => handleToggleViewMode('list')}
              title="List View"
              aria-label="List View"
            >
              ☰
            </button>
          </div>
          <button
            className="import-media-btn primary"
            onClick={handleImportClick}
            disabled={isImporting || isModalBlocked}
            title={isImporting ? 'Importing…' : 'Import media files into project'}
            aria-label="Import Media"
          >
            {isImporting ? (
              <span className="import-btn-loading">⏳</span>
            ) : (
              <>
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                </svg>
                <span className="import-btn-text">Import</span>
              </>
            )}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/*,.mp4,.mov,.mkv,.webm,.mp3,.wav,.aac,.png,.jpg,.jpeg,.webp,.wbmp,.wbpm"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
      </div>
      <div
        className="panel-body media-library-body"
        onDragOver={handlePanelDragOver}
        onDrop={handlePanelDrop}
      >
        {assets.length === 0 ? (
          <div className="media-empty">
            <div className="media-empty-icon">📁</div>
            <p className="media-empty-text">No media assets</p>
            <p className="media-empty-hint">Drag & drop files or click + Import</p>
          </div>
        ) : (
          <div className={`media-container mode-${viewMode}`}>
            {assets.map((asset) => {
              const isMissing = !!asset.isMissing
              return (
                <div
                  className={`media-item mode-${viewMode} ${isMissing ? 'is-missing' : ''}`}
                  key={asset.id}
                  draggable={!isMissing}
                  onDragStart={(e) => {
                    if (isMissing) return
                    const assetData = {
                      assetId: asset.id,
                      type: asset.type,
                      duration: asset.duration ?? 5,
                      name: asset.name,
                    }
                    setActiveDraggedAsset(assetData)
                    try {
                      ;(window as any).__AIDITOR_ACTIVE_DRAG_ASSET__ = assetData
                      e.dataTransfer.setData('application/aiditor-asset', JSON.stringify(assetData))
                      e.dataTransfer.setData('text/plain', JSON.stringify(assetData))
                    } catch {
                      // Ignore dataTransfer failure if any
                    }
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onDragEnd={() => {
                    setActiveDraggedAsset(null)
                    try {
                      delete (window as any).__AIDITOR_ACTIVE_DRAG_ASSET__
                    } catch {
                      // ignore
                    }
                  }}
                  title={
                    isMissing
                      ? `Media Offline: ${asset.path}`
                      : `Drag onto timeline (${asset.name})`
                  }
                >
                  <div className="media-item-visual">
                    {asset.thumbnailUrl ? (
                      <img
                        className="media-item-thumb"
                        src={asset.thumbnailUrl}
                        alt={asset.name}
                      />
                    ) : (
                      <span className="media-item-icon">{mediaTypeIcon(asset.type)}</span>
                    )}
                    {isMissing && <span className="media-missing-badge">OFFLINE</span>}
                    {asset.type === 'caption' && asset.metadata?.cueCount !== undefined && (
                      <span className="media-cue-badge">{asset.metadata.cueCount} cues</span>
                    )}
                  </div>

                  <div className="media-item-info">
                    <span className="media-item-name" title={asset.name}>{asset.name}</span>
                    {asset.type === 'caption' && (
                      <span className="media-item-meta">
                        <span className="caption-tag">Subtitles</span>
                        {asset.metadata?.cueCount ? ` • ${asset.metadata.cueCount} lines` : ''}
                      </span>
                    )}
                    {isMissing && (
                      <span className="media-item-meta">
                        <span className="missing-text">File unavailable</span>
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
