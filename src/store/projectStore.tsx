import {
  createContext,
  useContext,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { ProjectState } from '../core/project/projectState'
import type { EditorCommand } from '../core/commands/editorCommand'
import { CommandHistory } from '../core/commands/commandHistory'

/**
 * ProjectStore bridges the core CommandHistory/ProjectState system with React.
 *
 * Rules enforced:
 * - ProjectState is the single source of truth (never duplicated into React state)
 * - All mutations go through EditorCommands
 * - React re-renders are triggered by a subscription model (useSyncExternalStore)
 */
import { serializeProject } from '../core/persistence/projectSerializer'
import { addRecentProject } from '../core/persistence/recentProjects'
import { saveAutosave } from '../core/persistence/autosave'
import { modalCoordinator } from '../core/modalCoordinator'

async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
    try {
      return await (window as any).__TAURI_INTERNALS__.invoke(cmd, args)
    } catch (err) {
      console.warn(`tauri invoke ${cmd} error:`, err)
      return null
    }
  }
  return null
}

export interface SaveProjectResult {
  success: boolean
  filePath?: string
  error?: string
}

/**
 * ProjectStore bridges the core CommandHistory/ProjectState system with React.
 *
 * Rules enforced:
 * - ProjectState is the single source of truth (never duplicated into React state)
 * - All mutations go through EditorCommands
 * - React re-renders are triggered by a subscription model (useSyncExternalStore)
 */
export class ProjectStore {
  private history: CommandHistory
  private listeners: Set<() => void> = new Set()
  private projectFilePath: string | null = null
  private isDirty = false
  private savedHistoryIndex = 0
  private currentHistoryIndex = 0

  constructor(initialState: ProjectState, initialFilePath?: string) {
    this.history = new CommandHistory(initialState)
    this.projectFilePath = initialFilePath ?? initialState.projectFilePath ?? null
    this.isDirty = false
    this.savedHistoryIndex = 0
    this.currentHistoryIndex = 0
  }

  getState(): ProjectState {
    return this.history.getCurrentState()
  }

  getIsDirty(): boolean {
    return this.isDirty
  }

  getProjectFilePath(): string | null {
    return this.projectFilePath
  }

  setProjectFilePath(path: string | null): void {
    this.projectFilePath = path
    this.notify()
  }

  markClean(savedPath?: string): void {
    this.isDirty = false
    this.savedHistoryIndex = this.currentHistoryIndex
    if (savedPath !== undefined) {
      this.projectFilePath = savedPath
    }
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  dispatch(command: EditorCommand): ProjectState {
    const next = this.history.execute(command)
    if (command.isUndoable !== false) {
      this.currentHistoryIndex++
      this.isDirty = true
      // Trigger autosave on state mutation
      saveAutosave(next, this.projectFilePath ?? undefined)
    }
    this.notify()
    return next
  }

  undo(): ProjectState | null {
    const result = this.history.undo()
    if (result) {
      this.currentHistoryIndex = Math.max(0, this.currentHistoryIndex - 1)
      this.isDirty = this.currentHistoryIndex !== this.savedHistoryIndex
      this.notify()
    }
    return result
  }

  redo(): ProjectState | null {
    const result = this.history.redo()
    if (result) {
      this.currentHistoryIndex++
      this.isDirty = this.currentHistoryIndex !== this.savedHistoryIndex
      this.notify()
    }
    return result
  }

  canUndo(): boolean {
    return this.history.canUndo()
  }

  canRedo(): boolean {
    return this.history.canRedo()
  }

  clearMergeKey(): void {
    this.history.clearMergeKey()
  }

  /**
   * Reset the store with a completely new ProjectState.
   * This clears all undo/redo history.
   */
  reset(newState: ProjectState, newFilePath?: string): void {
    this.history = new CommandHistory(newState)
    this.projectFilePath = newFilePath ?? newState.projectFilePath ?? null
    this.isDirty = false
    this.savedHistoryIndex = 0
    this.currentHistoryIndex = 0
    this.notify()
  }

  /**
   * Saves the current project.
   * If no file path is set, prompts user via Save As dialog.
   */
  async save(targetPath?: string): Promise<SaveProjectResult> {
    const state = this.getState()
    let destination = targetPath ?? this.projectFilePath

    if (!destination) {
      return this.saveAs()
    }

    try {
      const content = serializeProject(state, destination)

      // Try native Tauri command first
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const err = await tauriInvoke<string>('save_project_file', {
          path: destination,
          content,
        })
        if (err !== null && err !== undefined && typeof err === 'string' && err.startsWith('Failed')) {
          return { success: false, error: err }
        }
      } else {
        // Browser fallback: download file
        const blob = new Blob([content], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = destination.split(/[\\/]/).pop() || `${state.name}.aiditor`
        a.click()
        URL.revokeObjectURL(url)
      }

      // Record in recent projects
      await addRecentProject(destination, state.name)

      this.markClean(destination)
      return { success: true, filePath: destination }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  /**
   * Always prompts the user for a new file destination, then saves.
   * Guarded with modalCoordinator to prevent multiple overlapping dialogs.
   */
  async saveAs(): Promise<SaveProjectResult> {
    const state = this.getState()
    let chosenPath: string | null = null

    chosenPath = await modalCoordinator.runExclusive('saveProject', async () => {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        return await tauriInvoke<string>('pick_save_project_file', {
          defaultName: `${state.name}.aiditor`,
          defaultDir: state.projectFolder,
        })
      } else {
        // In web browser test mode
        const defaultName = `${state.name || 'project'}.aiditor`
        return prompt('Save project as (.aiditor):', defaultName)
      }
    })

    if (!chosenPath) {
      return { success: false } // User cancelled
    }

    if (!chosenPath.endsWith('.aiditor')) {
      chosenPath += '.aiditor'
    }

    return this.save(chosenPath)
  }
}

// ──── React Context ────

const ProjectStoreContext = createContext<ProjectStore | null>(null)

export function ProjectStoreProvider({
  store,
  children,
}: {
  store: ProjectStore
  children: ReactNode
}) {
  return (
    <ProjectStoreContext.Provider value={store}>
      {children}
    </ProjectStoreContext.Provider>
  )
}

function useProjectStore(): ProjectStore {
  const store = useContext(ProjectStoreContext)
  if (!store) {
    throw new Error('useProjectStore must be used within a ProjectStoreProvider')
  }
  return store
}

/**
 * Subscribe to the full ProjectState. Re-renders when any command is dispatched.
 */
export function useProjectState(): ProjectState {
  const store = useProjectStore()
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getState()
  )
}

/**
 * Returns a stable dispatch function for executing EditorCommands.
 */
export function useDispatch(): (command: EditorCommand) => ProjectState {
  const store = useProjectStore()
  return useCallback((command: EditorCommand) => store.dispatch(command), [store])
}

/**
 * Returns undo/redo functions and their availability flags.
 */
export function useHistory() {
  const store = useProjectStore()
  const state = useProjectState() // subscribe to changes

  // We reference state to ensure canUndo/canRedo re-evaluate on state changes
  void state

  return {
    undo: useCallback(() => store.undo(), [store]),
    redo: useCallback(() => store.redo(), [store]),
    canUndo: store.canUndo(),
    canRedo: store.canRedo(),
  }
}

export function useProjectDirty(): boolean {
  const store = useProjectStore()
  useProjectState() // subscribe to changes
  return store.getIsDirty()
}

export function useProjectFilePath(): string | null {
  const store = useProjectStore()
  useProjectState() // subscribe to changes
  return store.getProjectFilePath()
}

export function useProjectPersistence() {
  const store = useProjectStore()
  const isDirty = useProjectDirty()
  const filePath = useProjectFilePath()

  return {
    isDirty,
    filePath,
    save: useCallback((targetPath?: string) => store.save(targetPath), [store]),
    saveAs: useCallback(() => store.saveAs(), [store]),
  }
}

export function useClearMergeKey(): () => void {
  const store = useContext(ProjectStoreContext)
  return useCallback(() => {
    store?.clearMergeKey()
  }, [store])
}


