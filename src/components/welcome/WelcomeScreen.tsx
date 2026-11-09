import { useState, useCallback, useEffect, useRef } from 'react'
import type { ProjectSettings } from '../../core/project/projectState'
import './WelcomeScreen.css'

export type ProjectFormat = 'horizontal' | 'vertical'

export interface FormatOption {
  id: ProjectFormat
  name: string
  width: number
  height: number
}

export const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: 'horizontal',
    name: 'Horizontal',
    width: 1920,
    height: 1080,
  },
  {
    id: 'vertical',
    name: 'Vertical',
    width: 1080,
    height: 1920,
  },
]

export interface NewProjectConfig {
  name: string
  projectFolder: string
  settings: ProjectSettings
}

import { ProjectStore } from '../../store/projectStore'

export interface WelcomeScreenProps {
  onCreateProject: (config: NewProjectConfig) => void
  onLoadDemo: () => void
  onOpenProject?: (store: ProjectStore) => void
}

interface TauriInternals {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals
  }
}

async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__?.invoke) {
    try {
      return await window.__TAURI_INTERNALS__.invoke<T>(cmd, args)
    } catch {
      return null
    }
  }
  return null
}

import {
  loadRecentProjects,
  removeRecentProject,
  clearRecentProjects,
  type RecentProject,
  hasAutosave,
  loadAutosave,
  clearAutosave,
  openProjectFromFile,
  openProjectFromContent,
} from '../../core/persistence'
import { modalCoordinator } from '../../core/modalCoordinator'

const DEFAULT_FALLBACK_DIR = 'C:\\Users\\Kushagra Singh\\Videos\\Aiditor Projects'

export function WelcomeScreen({ onCreateProject, onLoadDemo, onOpenProject }: WelcomeScreenProps) {
  const [showNewProject, setShowNewProject] = useState(false)
  const [projectName, setProjectName] = useState('My Project')
  const [projectFolder, setProjectFolder] = useState(DEFAULT_FALLBACK_DIR)
  const [selectedFormat, setSelectedFormat] = useState<ProjectFormat>('horizontal')
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [hasRecovery, setHasRecovery] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectFileInputRef = useRef<HTMLInputElement>(null)

  // Fetch dynamic OS default project folder, recent projects, and recovery check
  useEffect(() => {
    async function init() {
      const defaultDir = await tauriInvoke<string>('get_default_project_dir')
      if (defaultDir) {
        setProjectFolder(defaultDir)
      }
      const recents = await loadRecentProjects()
      setRecentProjects(recents)
      setHasRecovery(hasAutosave())
    }
    init()
  }, [])

  const handleBrowseFolder = useCallback(async () => {
    await modalCoordinator.runExclusive('pickFolder', async () => {
      const chosen = await tauriInvoke<string>('pick_project_folder')
      if (chosen) {
        setProjectFolder(chosen)
        return
      }
      fileInputRef.current?.click()
    })
  }, [])

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      const first = files[0]
      const relative = first.webkitRelativePath
      const folderName = relative ? relative.split('/')[0] : first.name
      if (folderName) {
        setProjectFolder((prev: string) => {
          const sep = prev.includes('\\') ? '\\' : '/'
          const base = prev.substring(0, prev.lastIndexOf(sep))
          return base ? `${base}${sep}${folderName}` : folderName
        })
      }
    }
  }

  const handleCreate = useCallback(() => {
    const format = FORMAT_OPTIONS.find((f) => f.id === selectedFormat) ?? FORMAT_OPTIONS[0]
    onCreateProject({
      name: projectName.trim() || 'Untitled Project',
      projectFolder: projectFolder.trim() || DEFAULT_FALLBACK_DIR,
      settings: {
        width: format.width,
        height: format.height,
        fps: 30,
        sampleRate: 48000,
      },
    })
  }, [projectName, projectFolder, selectedFormat, onCreateProject])

  const handleOpenProjectClick = useCallback(async () => {
    await modalCoordinator.runExclusive('openProject', async () => {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const result = await openProjectFromFile()
        if (result && onOpenProject) {
          onOpenProject(result.store)
          if (result.missingAssets.length > 0) {
            alert(
              `Project opened with ${result.missingAssets.length} missing media asset(s):\n• ${result.missingAssets.join('\n• ')}`
            )
          }
        }
      } else {
        projectFileInputRef.current?.click()
      }
    })
  }, [onOpenProject])

  const handleProjectFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const file = files[0]
    try {
      const text = await file.text()
      const result = openProjectFromContent(text, file.name)
      if (onOpenProject) {
        onOpenProject(result.store)
      }
    } catch (err) {
      alert(`Could not open project: ${(err as Error).message}`)
    }
  }

  const handleOpenRecent = useCallback(
    async (project: RecentProject) => {
      const result = await openProjectFromFile(project.path)
      if (result && onOpenProject) {
        onOpenProject(result.store)
        if (result.missingAssets.length > 0) {
          alert(
            `Project opened with ${result.missingAssets.length} missing media asset(s):\n• ${result.missingAssets.join('\n• ')}`
          )
        }
      } else {
        if (
          confirm(
            `Project file could not be found at:\n${project.path}\n\nRemove from recent list?`
          )
        ) {
          const updated = await removeRecentProject(project.path)
          setRecentProjects(updated)
        }
      }
    },
    [onOpenProject]
  )

  const handleClearRecents = useCallback(async () => {
    await clearRecentProjects()
    setRecentProjects([])
  }, [])

  const handleRestoreRecovery = useCallback(() => {
    const recovery = loadAutosave()
    if (recovery && onOpenProject) {
      const store = new ProjectStore(recovery.state, recovery.filePath)
      onOpenProject(store)
    }
  }, [onOpenProject])

  const handleDismissRecovery = useCallback(() => {
    clearAutosave()
    setHasRecovery(false)
  }, [])

  if (showNewProject) {
    return (
      <div className="welcome-screen">
        <div className="new-project-dialog">
          <button
            className="back-btn"
            onClick={() => setShowNewProject(false)}
            aria-label="Back to welcome"
          >
            ← Back
          </button>

          <h1 className="dialog-title">New Project</h1>

          {/* PROJECT NAME */}
          <div className="form-group">
            <label className="form-label" htmlFor="project-name">
              Project Name
            </label>
            <input
              id="project-name"
              className="form-input"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="My Project"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
              }}
            />
          </div>

          {/* PROJECT LOCATION */}
          <div className="form-group">
            <label className="form-label" htmlFor="project-location">
              Project Location
            </label>
            <div className="location-input-group">
              <input
                id="project-location"
                className="form-input location-input"
                type="text"
                value={projectFolder}
                onChange={(e) => setProjectFolder(e.target.value)}
                placeholder="Choose folder to store project files..."
                title="Folder where project files will be stored"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                }}
              />
              <button
                type="button"
                className="browse-btn"
                onClick={handleBrowseFolder}
                title="Browse and select another folder"
                aria-label="Browse folder"
              >
                📁 Browse
              </button>
              <input
                ref={fileInputRef}
                type="file"
                // @ts-expect-error webkitdirectory is standard in WebView/Chromium
                webkitdirectory=""
                directory=""
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
              />
            </div>
            <span className="location-hint">
              Project files will be saved in this folder
            </span>
          </div>

          {/* FORMAT */}
          <div className="form-group">
            <label className="form-label">Format</label>
            <div className="format-grid">
              {FORMAT_OPTIONS.map((fmt) => {
                const isSelected = selectedFormat === fmt.id
                return (
                  <button
                    key={fmt.id}
                    type="button"
                    className={`format-card ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedFormat(fmt.id)}
                    aria-label={`${fmt.name} format, ${fmt.width} by ${fmt.height}`}
                  >
                    <div className="format-preview-container">
                      <div className={`format-preview-shape ${fmt.id}`} />
                    </div>
                    <span className="format-card-title">{fmt.name}</span>
                    <span className="format-card-dims">
                      {fmt.width} × {fmt.height}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <button className="create-btn" onClick={handleCreate}>
            Create Project
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="welcome-screen">
      <input
        ref={projectFileInputRef}
        type="file"
        accept=".aiditor,application/json"
        style={{ display: 'none' }}
        onChange={handleProjectFileInputChange}
      />

      <div className="welcome-content">
        {hasRecovery && (
          <div className="recovery-banner">
            <span className="recovery-icon">⚠️</span>
            <div className="recovery-text">
              <span className="recovery-title">Unsaved Session Recovered</span>
              <span className="recovery-subtitle">
                An autosaved project session was found. Would you like to restore it?
              </span>
            </div>
            <button className="recovery-btn primary" onClick={handleRestoreRecovery}>
              Restore
            </button>
            <button className="recovery-btn secondary" onClick={handleDismissRecovery}>
              Dismiss
            </button>
          </div>
        )}

        <div className="welcome-logo">
          <div className="logo-icon">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="6" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="2" />
              <polygon points="13,11 22,16 13,21" fill="currentColor" />
            </svg>
          </div>
          <h1 className="welcome-title">aiditor</h1>
        </div>
        <p className="welcome-subtitle">AI-native video editor</p>

        <div className="welcome-actions">
          <button
            className="action-card primary"
            onClick={() => setShowNewProject(true)}
          >
            <span className="action-icon">✦</span>
            <div className="action-text">
              <span className="action-title">New Project</span>
              <span className="action-desc">Create a new video project</span>
            </div>
          </button>

          <button className="action-card" onClick={handleOpenProjectClick}>
            <span className="action-icon">📂</span>
            <div className="action-text">
              <span className="action-title">Open Project</span>
              <span className="action-desc">Open an existing .aiditor file</span>
            </div>
          </button>

          <button className="action-card" onClick={onLoadDemo}>
            <span className="action-icon">▶</span>
            <div className="action-text">
              <span className="action-title">Demo Project</span>
              <span className="action-desc">Explore with sample clips</span>
            </div>
          </button>
        </div>

        {recentProjects.length > 0 && (
          <div className="recent-projects-section">
            <div className="recent-projects-header">
              <span className="recent-title">Recent Projects</span>
              <button
                className="clear-recents-btn"
                onClick={handleClearRecents}
                title="Clear recent projects list"
              >
                Clear
              </button>
            </div>
            <div className="recent-projects-list">
              {recentProjects.map((p) => (
                <div
                  key={p.path}
                  className="recent-project-item"
                  onClick={() => handleOpenRecent(p)}
                  title={`Open ${p.path}`}
                >
                  <span className="recent-item-icon">🎬</span>
                  <div className="recent-item-info">
                    <span className="recent-item-name">{p.name}</span>
                    <span className="recent-item-path">{p.path}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
