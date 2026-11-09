import React, { useState, useRef, useEffect, useCallback } from 'react'
import { loadRecentProjects, type RecentProject } from '../../core/persistence/recentProjects'
import './MenuBar.css'

export interface MenuBarProps {
  projectName?: string
  isDirty?: boolean
  canUndo: boolean
  canRedo: boolean
  canDelete?: boolean
  canSplit?: boolean
  onUndo: () => void
  onRedo: () => void
  onDelete?: () => void
  onSplit?: () => void
  onNew?: () => void
  onSave?: () => void
  onSaveAs?: () => void
  onOpen?: () => void
  onOpenRecent?: (project: RecentProject) => void
  onClose?: () => void
  onExit?: () => void
  onImportMedia?: () => void
  onImportSubtitles?: () => void
  onGenerateAutoCaptions?: () => void
  onExportCaptions?: () => void
  canExportCaptions?: boolean
  onOpenProjectSettings?: () => void
  onToggleInspector?: () => void
  isInspectorVisible?: boolean
  onResetWorkspace?: () => void
  onOpenShortcuts?: () => void
  onOpenAbout?: () => void
}

type TopMenuId = 'file' | 'edit' | 'view' | 'help' | null

/**
 * Main Application Menu Bar.
 * Sits directly beneath the custom TitleBar.
 * Provides File, Edit, View, and Help menus with desktop-grade popovers and submenus.
 */
export const MenuBar: React.FC<MenuBarProps> = ({
  projectName: _projectName,
  isDirty = false,
  canUndo,
  canRedo,
  canDelete = false,
  canSplit = false,
  onUndo,
  onRedo,
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
  canExportCaptions = false,
  onOpenProjectSettings,
  onToggleInspector,
  isInspectorVisible = true,
  onResetWorkspace,
  onOpenShortcuts,
  onOpenAbout,
}) => {
  const [openMenu, setOpenMenu] = useState<TopMenuId>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<'recent' | 'import' | null>(null)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const menuBarRef = useRef<HTMLDivElement>(null)

  // Fetch recent projects when File menu opens
  useEffect(() => {
    if (openMenu === 'file') {
      loadRecentProjects()
        .then((recents) => {
          setRecentProjects(recents.slice(0, 10))
        })
        .catch(() => {})
    }
  }, [openMenu])

  // Dismiss menus on outside click or ESC
  useEffect(() => {
    if (!openMenu) return

    const handleMouseDown = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
        setActiveSubmenu(null)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null)
        setActiveSubmenu(null)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenu])

  const handleMenuTriggerClick = useCallback((menuId: TopMenuId) => {
    setOpenMenu((prev) => (prev === menuId ? null : menuId))
    setActiveSubmenu(null)
  }, [])

  const handleMenuTriggerHover = useCallback(
    (menuId: TopMenuId) => {
      if (openMenu !== null) {
        setOpenMenu(menuId)
        setActiveSubmenu(null)
      }
    },
    [openMenu]
  )

  const closeAndRun = useCallback((fn?: () => void) => {
    setOpenMenu(null)
    setActiveSubmenu(null)
    fn?.()
  }, [])

  return (
    <div className="aiditor-menubar no-select" ref={menuBarRef}>
      {/* ──── FILE MENU ──── */}
      <div className="menubar-item-wrapper">
        <button
          className={`menubar-btn toolbar-file-menu-btn ${openMenu === 'file' ? 'active' : ''}`}
          onClick={() => handleMenuTriggerClick('file')}
          onMouseEnter={() => handleMenuTriggerHover('file')}
          aria-haspopup="true"
          aria-expanded={openMenu === 'file'}
        >
          <span>File</span>
          {isDirty && <span className="menubar-dirty-dot" title="Unsaved changes">●</span>}
        </button>

        {openMenu === 'file' && (
          <div className="menubar-dropdown" role="menu">
            {onNew && (
              <button className="menubar-dropdown-item" role="menuitem" onClick={() => closeAndRun(onNew)}>
                <span className="dropdown-item-label">New Project</span>
                <span className="dropdown-item-shortcut">Ctrl+N</span>
              </button>
            )}

            {onOpen && (
              <button className="menubar-dropdown-item" role="menuitem" onClick={() => closeAndRun(onOpen)}>
                <span className="dropdown-item-label">Open Project…</span>
                <span className="dropdown-item-shortcut">Ctrl+O</span>
              </button>
            )}

            {/* Recent Projects Submenu */}
            <div
              className="menubar-submenu-parent"
              onMouseEnter={() => setActiveSubmenu('recent')}
              onMouseLeave={() => setActiveSubmenu(null)}
            >
              <button className="menubar-dropdown-item has-submenu" role="menuitem">
                <span className="dropdown-item-label">Recent Projects</span>
                <span className="dropdown-submenu-arrow">›</span>
              </button>

              {activeSubmenu === 'recent' && (
                <div className="menubar-submenu" role="menu">
                  {recentProjects.length > 0 ? (
                    recentProjects.map((proj) => (
                      <button
                        key={proj.path}
                        className="menubar-dropdown-item"
                        role="menuitem"
                        onClick={() => closeAndRun(() => onOpenRecent?.(proj))}
                        title={proj.path}
                      >
                        <span className="dropdown-item-label recent-name">{proj.name}</span>
                      </button>
                    ))
                  ) : (
                    <div className="menubar-dropdown-item disabled">
                      <span className="dropdown-item-label muted">No recent projects</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="menubar-divider" />

            {/* Import Submenu */}
            <div
              className="menubar-submenu-parent"
              onMouseEnter={() => setActiveSubmenu('import')}
              onMouseLeave={() => setActiveSubmenu(null)}
            >
              <button className="menubar-dropdown-item has-submenu" role="menuitem">
                <span className="dropdown-item-label">Import</span>
                <span className="dropdown-submenu-arrow">›</span>
              </button>

              {activeSubmenu === 'import' && (
                <div className="menubar-submenu" role="menu">
                  {onImportMedia && (
                    <button
                      className="menubar-dropdown-item"
                      role="menuitem"
                      onClick={() => closeAndRun(onImportMedia)}
                    >
                      <span className="dropdown-item-label">Media…</span>
                    </button>
                  )}
                  {onImportSubtitles && (
                    <button
                      className="menubar-dropdown-item"
                      role="menuitem"
                      onClick={() => closeAndRun(onImportSubtitles)}
                    >
                      <span className="dropdown-item-label">Subtitle File…</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="menubar-divider" />

            {onGenerateAutoCaptions && <>
              <button className="menubar-dropdown-item" role="menuitem" onClick={() => closeAndRun(onGenerateAutoCaptions)}>
                <span className="dropdown-item-label">Generate Auto Captions...</span>
              </button>
              <div className="menubar-divider" />
            </>}

            {onExportCaptions && <button className="menubar-dropdown-item" role="menuitem" disabled={!canExportCaptions}
              onClick={() => closeAndRun(onExportCaptions)} title={canExportCaptions ? 'Export timeline captions as SRT or WebVTT' : 'Add captions to a visible timeline track first'}>
              <span className="dropdown-item-label">Export Captions...</span>
            </button>}

            {onSave && (
              <button className="menubar-dropdown-item" role="menuitem" onClick={() => closeAndRun(onSave)}>
                <span className="dropdown-item-label">Save</span>
                <span className="dropdown-item-shortcut">Ctrl+S</span>
              </button>
            )}

            {onSaveAs && (
              <button className="menubar-dropdown-item" role="menuitem" onClick={() => closeAndRun(onSaveAs)}>
                <span className="dropdown-item-label">Save As…</span>
                <span className="dropdown-item-shortcut">Ctrl+Shift+S</span>
              </button>
            )}

            <div className="menubar-divider" />

            {onOpenProjectSettings && (
              <button
                className="menubar-dropdown-item"
                role="menuitem"
                onClick={() => closeAndRun(onOpenProjectSettings)}
              >
                <span className="dropdown-item-label">Project Settings…</span>
              </button>
            )}

            <div className="menubar-divider" />

            {onClose && (
              <button
                className="menubar-dropdown-item"
                role="menuitem"
                onClick={() => closeAndRun(onClose)}
              >
                <span className="dropdown-item-label">Close Project</span>
              </button>
            )}

            {onExit && (
              <>
                <div className="menubar-divider" />
                <button
                  className="menubar-dropdown-item danger"
                  role="menuitem"
                  onClick={() => closeAndRun(onExit)}
                >
                  <span className="dropdown-item-label">Exit Application</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ──── EDIT MENU ──── */}
      <div className="menubar-item-wrapper">
        <button
          className={`menubar-btn ${openMenu === 'edit' ? 'active' : ''}`}
          onClick={() => handleMenuTriggerClick('edit')}
          onMouseEnter={() => handleMenuTriggerHover('edit')}
          aria-haspopup="true"
          aria-expanded={openMenu === 'edit'}
        >
          Edit
        </button>

        {openMenu === 'edit' && (
          <div className="menubar-dropdown" role="menu">
            <button
              className="menubar-dropdown-item"
              role="menuitem"
              disabled={!canUndo}
              onClick={() => closeAndRun(onUndo)}
            >
              <span className="dropdown-item-label">Undo</span>
              <span className="dropdown-item-shortcut">Ctrl+Z</span>
            </button>
            <button
              className="menubar-dropdown-item"
              role="menuitem"
              disabled={!canRedo}
              onClick={() => closeAndRun(onRedo)}
            >
              <span className="dropdown-item-label">Redo</span>
              <span className="dropdown-item-shortcut">Ctrl+Y</span>
            </button>

            <div className="menubar-divider" />

            <button
              className="menubar-dropdown-item"
              role="menuitem"
              disabled={!canDelete}
              onClick={() => closeAndRun(onDelete)}
            >
              <span className="dropdown-item-label">Delete</span>
              <span className="dropdown-item-shortcut">Delete</span>
            </button>

            <button
              className="menubar-dropdown-item"
              role="menuitem"
              disabled={!canSplit}
              onClick={() => closeAndRun(onSplit)}
            >
              <span className="dropdown-item-label">Split at Playhead</span>
              <span className="dropdown-item-shortcut">S</span>
            </button>
          </div>
        )}
      </div>

      {/* ──── VIEW MENU ──── */}
      <div className="menubar-item-wrapper">
        <button
          className={`menubar-btn ${openMenu === 'view' ? 'active' : ''}`}
          onClick={() => handleMenuTriggerClick('view')}
          onMouseEnter={() => handleMenuTriggerHover('view')}
          aria-haspopup="true"
          aria-expanded={openMenu === 'view'}
        >
          View
        </button>

        {openMenu === 'view' && (
          <div className="menubar-dropdown" role="menu">
            {onToggleInspector && (
              <button
                className="menubar-dropdown-item"
                role="menuitem"
                onClick={() => closeAndRun(onToggleInspector)}
              >
                <span className="dropdown-item-check">{isInspectorVisible ? '✓' : ''}</span>
                <span className="dropdown-item-label">Inspector Panel</span>
              </button>
            )}

            <div className="menubar-divider" />

            {onResetWorkspace && (
              <button
                className="menubar-dropdown-item"
                role="menuitem"
                onClick={() => closeAndRun(onResetWorkspace)}
              >
                <span className="dropdown-item-check" />
                <span className="dropdown-item-label">Reset Workspace Layout</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ──── HELP MENU ──── */}
      <div className="menubar-item-wrapper">
        <button
          className={`menubar-btn ${openMenu === 'help' ? 'active' : ''}`}
          onClick={() => handleMenuTriggerClick('help')}
          onMouseEnter={() => handleMenuTriggerHover('help')}
          aria-haspopup="true"
          aria-expanded={openMenu === 'help'}
        >
          Help
        </button>

        {openMenu === 'help' && (
          <div className="menubar-dropdown" role="menu">
            {onOpenShortcuts && (
              <button
                className="menubar-dropdown-item"
                role="menuitem"
                onClick={() => closeAndRun(onOpenShortcuts)}
              >
                <span className="dropdown-item-label">Keyboard Shortcuts…</span>
              </button>
            )}

            <div className="menubar-divider" />

            {onOpenAbout && (
              <button
                className="menubar-dropdown-item"
                role="menuitem"
                onClick={() => closeAndRun(onOpenAbout)}
              >
                <span className="dropdown-item-label">About aiditor</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
